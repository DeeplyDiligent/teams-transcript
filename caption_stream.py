"""Shared, database-backed caption change coordination."""

import atexit
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone


CHANGE_POLL_SECONDS = 0.5
HEARTBEAT_SECONDS = 15
MAX_STREAM_SECONDS = 300
CHANGE_RETENTION_SECONDS = 24 * 60 * 60


def ensure_change_tracking_schema(conn):
    """Create the durable change journal used by stream subscribers."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS caption_changes (
            change_id INTEGER PRIMARY KEY AUTOINCREMENT,
            caption_id INTEGER NOT NULL,
            meeting_id INTEGER NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('insert', 'update')),
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_caption_changes_meeting_change
        ON caption_changes(meeting_id, change_id)
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS captions_change_after_insert
        AFTER INSERT ON captions
        BEGIN
            INSERT INTO caption_changes (caption_id, meeting_id, operation)
            VALUES (NEW.caption_id, NEW.meeting_id, 'insert');
        END
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS captions_change_after_update
        AFTER UPDATE OF speaker, text ON captions
        WHEN OLD.speaker IS NOT NEW.speaker OR OLD.text IS NOT NEW.text
        BEGIN
            INSERT INTO caption_changes (caption_id, meeting_id, operation)
            VALUES (NEW.caption_id, NEW.meeting_id, 'update');
        END
    """)
    conn.commit()


class CaptionStreamService:
    """Runs one SQLite watcher and coordinates all caption streams."""

    def __init__(
        self,
        db_path,
        poll_seconds=CHANGE_POLL_SECONDS,
        heartbeat_seconds=HEARTBEAT_SECONDS,
        max_stream_seconds=MAX_STREAM_SECONDS,
    ):
        self.db_path = db_path
        self.poll_seconds = poll_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.max_stream_seconds = max_stream_seconds
        self._condition = threading.Condition()
        self._stop_event = threading.Event()
        self._refresh_event = threading.Event()
        self._lifecycle_lock = threading.Lock()
        self._streams_lock = threading.Lock()
        self._active_streams = {}
        self._latest_change_id = 0
        self._watcher = None
        self._last_error = None
        self._last_poll_at = None

    def start(self):
        with self._lifecycle_lock:
            if self._watcher and self._watcher.is_alive():
                return
            with self._connect() as conn:
                ensure_change_tracking_schema(conn)
                self._latest_change_id = self._read_latest_change_id(conn)
            self._stop_event.clear()
            self._watcher = threading.Thread(
                target=self._watch_changes,
                name="caption-change-watcher",
                daemon=True,
            )
            self._watcher.start()

    def stop(self):
        self._stop_event.set()
        self._refresh_event.set()
        with self._condition:
            self._condition.notify_all()
        watcher = self._watcher
        if watcher and watcher.is_alive():
            watcher.join(timeout=max(2, self.poll_seconds * 3))

    def refresh(self):
        """Wake the watcher immediately after an in-process caption commit."""
        self._refresh_event.set()

    def initial_snapshot(self, meeting_id, caption_limit=None):
        """Return a consistent initial caption snapshot and change cursor."""
        with self._connect() as conn:
            conn.execute("BEGIN")
            cursor = self._read_latest_change_id(conn)
            if caption_limit:
                rows = conn.execute("""
                    SELECT * FROM (
                        SELECT caption_id, meeting_id, runtime_id, speaker, text,
                               timestamp, created_at, updated_at
                        FROM captions
                        WHERE meeting_id = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    )
                    ORDER BY timestamp ASC
                """, (meeting_id, caption_limit)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT caption_id, meeting_id, runtime_id, speaker, text,
                           timestamp, created_at, updated_at
                    FROM captions
                    WHERE meeting_id = ?
                    ORDER BY timestamp ASC
                """, (meeting_id,)).fetchall()
            conn.commit()
        return [dict(row) for row in rows], cursor

    def changes_since(self, meeting_id, change_id, batch_size=500):
        """Return de-duplicated caption changes after a stream cursor."""
        with self._connect() as conn:
            cursor_row = conn.execute("""
                SELECT COALESCE(MAX(change_id), ?) AS change_id
                FROM (
                    SELECT change_id
                    FROM caption_changes
                    WHERE change_id > ?
                    ORDER BY change_id ASC
                    LIMIT ?
                )
            """, (change_id, change_id, batch_size)).fetchone()
            next_cursor = cursor_row["change_id"]
            if next_cursor == change_id:
                return [], change_id

            rows = conn.execute("""
                SELECT changes.change_id, changes.operation,
                       captions.caption_id, captions.meeting_id,
                       captions.runtime_id, captions.speaker, captions.text,
                       captions.timestamp, captions.created_at, captions.updated_at
                FROM caption_changes AS changes
                JOIN captions ON captions.caption_id = changes.caption_id
                WHERE changes.meeting_id = ?
                  AND changes.change_id > ?
                  AND changes.change_id <= ?
                ORDER BY changes.change_id ASC
            """, (meeting_id, change_id, next_cursor)).fetchall()

        latest_by_caption = {}
        for row in rows:
            item = dict(row)
            latest_by_caption[item["caption_id"]] = item
        return list(latest_by_caption.values()), next_cursor

    def wait_for_change(self, change_id, timeout):
        """Block without polling until the shared watcher sees a newer change."""
        deadline = time.monotonic() + timeout
        with self._condition:
            while (
                self._latest_change_id <= change_id
                and not self._stop_event.is_set()
            ):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)
            return self._latest_change_id > change_id

    @contextmanager
    def stream(self, meeting_id):
        stream_id = uuid.uuid4().hex
        started_at = time.time()
        with self._streams_lock:
            self._active_streams[stream_id] = {
                "meeting_id": meeting_id,
                "started_at": started_at,
            }
        try:
            yield stream_id
        finally:
            with self._streams_lock:
                self._active_streams.pop(stream_id, None)

    def diagnostics(self):
        with self._streams_lock:
            streams = list(self._active_streams.values())
        now = time.time()
        return {
            "active_streams": len(streams),
            "oldest_stream_seconds": round(
                max((now - stream["started_at"] for stream in streams), default=0),
                2,
            ),
            "latest_change_id": self._latest_change_id,
            "watcher_alive": bool(self._watcher and self._watcher.is_alive()),
            "last_poll_at": self._last_poll_at,
            "last_error": self._last_error,
            "poll_seconds": self.poll_seconds,
            "heartbeat_seconds": self.heartbeat_seconds,
            "max_stream_seconds": self.max_stream_seconds,
        }

    def _watch_changes(self):
        next_cleanup = time.monotonic() + 3600
        while not self._stop_event.is_set():
            try:
                with self._connect() as conn:
                    latest = self._read_latest_change_id(conn)
                    if time.monotonic() >= next_cleanup:
                        conn.execute(
                            "DELETE FROM caption_changes WHERE changed_at < datetime('now', ?)",
                            (f"-{CHANGE_RETENTION_SECONDS} seconds",),
                        )
                        conn.commit()
                        next_cleanup = time.monotonic() + 3600
                self._last_poll_at = datetime.now(timezone.utc).isoformat()
                self._last_error = None
                if latest > self._latest_change_id:
                    with self._condition:
                        self._latest_change_id = latest
                        self._condition.notify_all()
            except sqlite3.Error as exc:
                self._last_error = str(exc)

            self._refresh_event.wait(self.poll_seconds)
            self._refresh_event.clear()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def _read_latest_change_id(conn):
        row = conn.execute(
            "SELECT COALESCE(MAX(change_id), 0) AS change_id FROM caption_changes"
        ).fetchone()
        return row["change_id"]


_services = {}
_services_lock = threading.Lock()


def get_caption_stream_service(db_path):
    absolute_path = str(db_path)
    with _services_lock:
        service = _services.get(absolute_path)
        if service is None:
            service = CaptionStreamService(absolute_path)
            service.start()
            _services[absolute_path] = service
        return service


def notify_caption_changes():
    with _services_lock:
        services = list(_services.values())
    for service in services:
        service.refresh()


def stop_caption_stream_services():
    with _services_lock:
        services = list(_services.values())
        _services.clear()
    for service in services:
        service.stop()


atexit.register(stop_caption_stream_services)
