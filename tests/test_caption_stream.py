import json
import io
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path

from api import create_app
from caption_stream import CaptionStreamService
from capture_captions import CaptionConsoleRenderer, TranscriptDatabase


class InteractiveBuffer(io.StringIO):
    def isatty(self):
        return True


class CaptionStreamTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp_dir.name) / "transcripts.db")
        self.database = TranscriptDatabase(self.db_path)
        self.meeting_id = self.database.create_meeting(
            "Architecture review",
            "Architecture review | Microsoft Teams",
            123,
        )

    def tearDown(self):
        self.database.close()
        self.temp_dir.cleanup()

    def test_caption_snapshot_writes_only_real_changes(self):
        snapshot = {
            "runtime-1": {
                "speaker": "Ada",
                "text": "Initial caption",
                "timestamp": datetime.now(),
            }
        }

        first = self.database.upsert_captions(self.meeting_id, snapshot)
        unchanged = self.database.upsert_captions(self.meeting_id, snapshot)
        snapshot["runtime-1"]["text"] = "Updated caption"
        updated = self.database.upsert_captions(self.meeting_id, snapshot)

        with closing(sqlite3.connect(self.db_path)) as conn:
            changes = conn.execute(
                "SELECT operation FROM caption_changes ORDER BY change_id"
            ).fetchall()

        self.assertEqual(first, [("runtime-1", True, True)])
        self.assertEqual(unchanged, [("runtime-1", False, False)])
        self.assertEqual(updated, [("runtime-1", False, True)])
        self.assertEqual(changes, [("insert",), ("update",)])

    def test_caption_updates_rewrite_the_active_terminal_line(self):
        stream = InteractiveBuffer()
        renderer = CaptionConsoleRenderer(stream)

        renderer.render("runtime-1", "Ada", "Initial", is_new=True)
        renderer.render("runtime-1", "Ada", "Initial caption", is_new=False)
        renderer.render("runtime-2", "Grace", "Next caption", is_new=True)
        renderer.finish_line()

        output = stream.getvalue()
        self.assertNotIn("[NEW]", output)
        self.assertNotIn("[UPD]", output)
        self.assertIn("\r\033[2K", output)
        self.assertIn("Ada: Initial caption", output)
        self.assertIn("Grace: Next caption", output)
        self.assertEqual(output.count("\n"), 2)

    def test_noninteractive_logs_do_not_repeat_caption_updates(self):
        stream = io.StringIO()
        renderer = CaptionConsoleRenderer(stream)

        renderer.render("runtime-1", "Ada", "Initial", is_new=True)
        renderer.render("runtime-1", "Ada", "Initial caption", is_new=False)

        output = stream.getvalue()
        self.assertIn("Ada: Initial", output)
        self.assertNotIn("Initial caption", output)

    def test_shared_watcher_delivers_incremental_changes(self):
        service = CaptionStreamService(self.db_path, poll_seconds=0.01)
        service.start()
        try:
            initial, cursor = service.initial_snapshot(self.meeting_id)
            self.assertEqual(initial, [])

            self.database.upsert_captions(
                self.meeting_id,
                {
                    "runtime-2": {
                        "speaker": "Grace",
                        "text": "A new event",
                        "timestamp": datetime.now(),
                    }
                },
            )
            service.refresh()

            self.assertTrue(service.wait_for_change(cursor, timeout=1))
            changes, next_cursor = service.changes_since(
                self.meeting_id,
                cursor,
            )

            self.assertGreater(next_cursor, cursor)
            self.assertEqual(len(changes), 1)
            self.assertEqual(changes[0]["operation"], "insert")
            self.assertEqual(changes[0]["text"], "A new event")
        finally:
            service.stop()

    def test_stream_registration_is_released(self):
        service = CaptionStreamService(self.db_path)
        service.start()
        try:
            with service.stream(self.meeting_id):
                self.assertEqual(service.diagnostics()["active_streams"], 1)
            self.assertEqual(service.diagnostics()["active_streams"], 0)
        finally:
            service.stop()

    def test_stream_cursor_advances_past_other_meetings(self):
        other_meeting_id = self.database.create_meeting(
            "Other meeting",
            "Other meeting | Microsoft Teams",
            456,
        )
        service = CaptionStreamService(self.db_path, poll_seconds=0.01)
        service.start()
        try:
            _, cursor = service.initial_snapshot(self.meeting_id)
            self.database.upsert_captions(
                other_meeting_id,
                {
                    "runtime-other": {
                        "speaker": "Linus",
                        "text": "Unrelated caption",
                        "timestamp": datetime.now(),
                    }
                },
            )
            service.refresh()
            self.assertTrue(service.wait_for_change(cursor, timeout=1))

            changes, next_cursor = service.changes_since(
                self.meeting_id,
                cursor,
            )

            self.assertEqual(changes, [])
            self.assertGreater(next_cursor, cursor)
            self.assertFalse(service.wait_for_change(next_cursor, timeout=0.02))
        finally:
            service.stop()

    def test_sse_heartbeat_and_expiry_are_bounded(self):
        service = CaptionStreamService(
            self.db_path,
            poll_seconds=0.005,
            heartbeat_seconds=0.01,
            max_stream_seconds=0.03,
        )
        service.start()
        app = create_app(
            static_folder=self.temp_dir.name,
            db_path=self.db_path,
            caption_stream_service=service,
        )
        app.testing = True

        try:
            response = app.test_client().get(
                f"/api/meetings/{self.meeting_id}/captions",
                buffered=False,
            )
            chunks = []
            deadline = time.monotonic() + 1
            for chunk in response.response:
                chunks.append(chunk.decode())
                if "event: reconnect" in chunks[-1]:
                    break
                if time.monotonic() > deadline:
                    self.fail("SSE stream did not expire")

            payload = "".join(chunks)
            initial_line = next(
                line for line in payload.splitlines() if line.startswith("data: ")
            )
            initial = json.loads(initial_line.removeprefix("data: "))

            self.assertEqual(initial["type"], "initial")
            self.assertIn(": heartbeat ", payload)
            self.assertIn("event: reconnect", payload)
            response.close()
            self.assertEqual(service.diagnostics()["active_streams"], 0)
        finally:
            service.stop()


if __name__ == "__main__":
    unittest.main()
