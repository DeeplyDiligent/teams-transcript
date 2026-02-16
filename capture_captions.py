"""
Teams Live Caption Monitor
Monitors Teams captions every 500ms and maintains a live transcript.
Uses SQLite for efficient storage and background thread for exports.
"""

import time
import os
import sqlite3
import threading
from datetime import datetime
from pywinauto import Desktop

# Configuration
ENABLE_MARKDOWN_EXPORT = False  # Set to True to enable automatic markdown file exports


class TranscriptDatabase:
    """Handles SQLite database operations for transcript storage."""
    
    def __init__(self, db_path='transcripts.db'):
        self.db_path = db_path
        self.conn = None
        self.lock = threading.Lock()
        self.init_database()
    
    def init_database(self):
        """Initialize database schema."""
        # Register datetime adapters to avoid deprecation warning
        sqlite3.register_adapter(datetime, lambda dt: dt.isoformat())
        sqlite3.register_converter("TIMESTAMP", lambda s: datetime.fromisoformat(s.decode()))
        
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False, detect_types=sqlite3.PARSE_DECLTYPES)
        self.conn.execute('PRAGMA journal_mode=WAL')  # Better for concurrent access
        
        cursor = self.conn.cursor()
        
        # Create schema_version table to track migrations
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Get current schema version
        cursor.execute('SELECT MAX(version) FROM schema_version')
        result = cursor.fetchone()
        current_version = result[0] if result[0] is not None else 0
        
        # Meetings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS meetings (
                meeting_id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_name TEXT,
                window_title TEXT,
                window_id INTEGER,
                start_time TIMESTAMP,
                last_activity TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Captions table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS captions (
                caption_id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER,
                runtime_id TEXT,
                speaker TEXT,
                text TEXT,
                timestamp TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
                UNIQUE(meeting_id, runtime_id)
            )
        ''')
        
        # Indexes
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_meeting_timestamp ON captions(meeting_id, timestamp)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_runtime_id ON captions(meeting_id, runtime_id)')
        
        # Run migrations
        self._run_migrations(cursor, current_version)
        
        self.conn.commit()
        print(f"Database initialized: {self.db_path}")
    
    def _run_migrations(self, cursor, current_version):
        """Run database migrations in order."""
        
        # Migration 1: Add window_id column to meetings table
        if current_version < 1:
            try:
                # Check if column already exists
                cursor.execute("PRAGMA table_info(meetings)")
                columns = [col[1] for col in cursor.fetchall()]
                
                if 'window_id' not in columns:
                    cursor.execute('ALTER TABLE meetings ADD COLUMN window_id INTEGER')
                    print("[DB] Migration 1: Added window_id column to meetings table")
                
                cursor.execute('INSERT INTO schema_version (version) VALUES (1)')
            except Exception as e:
                print(f"[DB] Migration 1 failed (may be already applied): {e}")
        
        # Migration 2: Add chat_messages table
        if current_version < 2:
            try:
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        meeting_id INTEGER NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id)
                    )
                ''')
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_chat_meeting ON chat_messages(meeting_id, timestamp)')
                cursor.execute('INSERT INTO schema_version (version) VALUES (2)')
                print("[DB] Migration 2: Created chat_messages table")
            except Exception as e:
                print(f"[DB] Migration 2 failed (may be already applied): {e}")
        
        # Future migrations go here:
        # if current_version < 3:
        #     cursor.execute('ALTER TABLE ...')
        #     cursor.execute('INSERT INTO schema_version (version) VALUES (3)')
        #     print("[DB] Migration 3: Description")
    
    def find_meeting_by_window(self, window_id, meeting_name):
        """Find an existing meeting by window_id and meeting_name."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT meeting_id FROM meetings 
                WHERE window_id = ? AND meeting_name = ?
                ORDER BY start_time DESC
                LIMIT 1
            ''', (window_id, meeting_name))
            result = cursor.fetchone()
            return result[0] if result else None
    
    def create_meeting(self, meeting_name, window_title, window_id=None):
        """Create a new meeting record."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                INSERT INTO meetings (meeting_name, window_title, window_id, start_time, last_activity)
                VALUES (?, ?, ?, ?, ?)
            ''', (meeting_name, window_title, window_id, datetime.now(), datetime.now()))
            self.conn.commit()
            return cursor.lastrowid
    
    def update_meeting_activity(self, meeting_id):
        """Update last activity timestamp for a meeting."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                UPDATE meetings SET last_activity = ? WHERE meeting_id = ?
            ''', (datetime.now(), meeting_id))
            self.conn.commit()
    
    def insert_or_update_caption(self, meeting_id, runtime_id, speaker, text, timestamp):
        """Insert a new caption or update existing one."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                INSERT INTO captions (meeting_id, runtime_id, speaker, text, timestamp)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(meeting_id, runtime_id) 
                DO UPDATE SET text=excluded.text, updated_at=CURRENT_TIMESTAMP
            ''', (meeting_id, runtime_id, speaker, text, timestamp))
            self.conn.commit()
            return cursor.lastrowid
    
    def get_recent_captions(self, meeting_id, limit=50):
        """Get the most recent captions for display."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT runtime_id, speaker, text, timestamp
                FROM captions
                WHERE meeting_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            ''', (meeting_id, limit))
            return cursor.fetchall()
    
    def get_all_captions(self, meeting_id):
        """Get all captions for a meeting, ordered by timestamp."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT runtime_id, speaker, text, timestamp
                FROM captions
                WHERE meeting_id = ?
                ORDER BY timestamp ASC
            ''', (meeting_id,))
            return cursor.fetchall()
    
    def get_meeting_stats(self, meeting_id):
        """Get statistics for a meeting."""
        with self.lock:
            cursor = self.conn.cursor()
            
            # Get participants
            cursor.execute('''
                SELECT DISTINCT speaker FROM captions WHERE meeting_id = ?
            ''', (meeting_id,))
            participants = [row[0] for row in cursor.fetchall()]
            
            # Get caption count and time range
            cursor.execute('''
                SELECT COUNT(*), MIN(timestamp), MAX(timestamp)
                FROM captions WHERE meeting_id = ?
            ''', (meeting_id,))
            count, start_time, end_time = cursor.fetchone()
            
            # Get meeting name
            cursor.execute('''
                SELECT meeting_name FROM meetings WHERE meeting_id = ?
            ''', (meeting_id,))
            meeting_name = cursor.fetchone()[0]
            
            return {
                'meeting_name': meeting_name,
                'participants': participants,
                'caption_count': count or 0,
                'start_time': start_time,
                'end_time': end_time
            }
    
    def caption_exists(self, meeting_id, runtime_id):
        """Check if a caption already exists."""
        with self.lock:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT 1 FROM captions WHERE meeting_id = ? AND runtime_id = ?
            ''', (meeting_id, runtime_id))
            return cursor.fetchone() is not None
    
    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()


def get_teams_window():
    """Find the Teams meeting window."""
    desktop = Desktop(backend='uia')
    for window in desktop.windows():
        try:
            title = window.window_text()
            class_name = window.class_name()
            if class_name == 'TeamsWebView':
                # Check if this is a meeting window by looking for meeting controls
                if is_meeting_window(window):
                    return window
        except:
            continue
    return None


def is_meeting_window(window):
    """Check if a Teams window is a meeting by looking for meeting-specific controls."""
    try:
        for elem in window.descendants():
            try:
                name = getattr(elem.element_info, 'name', '')
                # Look for meeting-specific UI elements
                if name and any(keyword in str(name).lower() for keyword in ['meeting controls', 'leave call', 'calling controls']):
                    return True
            except:
                continue
    except:
        pass
    return False


def get_teams_window_with_captions():
    """Find the first Teams meeting window that has live captions enabled.
    Prioritizes the focused/active window if it has captions."""
    desktop = Desktop(backend='uia')
    windows_with_captions = []
    
    for window in desktop.windows():
        try:
            title = window.window_text()
            class_name = window.class_name()
            if class_name == 'TeamsWebView' and is_meeting_window(window):
                # Check if this window has live captions
                live_captions = get_live_captions_group(window)
                if live_captions:
                    windows_with_captions.append(window)
        except:
            continue
    
    if not windows_with_captions:
        return None
    
    # If only one, return it
    if len(windows_with_captions) == 1:
        return windows_with_captions[0]
    
    # Multiple windows with captions - prioritize the focused one
    for window in windows_with_captions:
        try:
            if window.has_focus():
                return window
        except:
            continue
    
    # No focused window found, return the first one
    return windows_with_captions[0]


def get_live_captions_group(teams_window):
    """Find the Live Captions group in Teams window."""
    for elem in teams_window.descendants():
        try:
            name = getattr(elem.element_info, 'name', '')
            elem_type = elem.element_info.control_type
            
            if elem_type == 'Group' and 'live captions' in str(name).lower():
                return elem
        except:
            continue
    return None


def extract_captions(live_captions_group):
    """Extract all captions with their runtime IDs from Live Captions group."""
    captions = {}
    
    try:
        children = live_captions_group.children()
        if not children:
            return captions
            
        caption_container = children[0]
        inner_children = caption_container.children()
        
        for child in inner_children:
            try:
                c_type = child.element_info.control_type
                c_runtime_id = getattr(child.element_info, 'runtime_id', None)
                
                # Only process Group elements with runtime IDs
                if c_type == 'Group' and c_runtime_id:
                    runtime_id_str = str(c_runtime_id)
                    
                    # Check if this group has grandchildren (caption data)
                    grandchildren = child.children()
                    if len(grandchildren) >= 2:
                        speaker = grandchildren[0].window_text()
                        # Caption text is always the last child (handles badges in between)
                        caption_text = grandchildren[-1].window_text()
                        
                        if speaker and caption_text:
                            captions[runtime_id_str] = {
                                'speaker': speaker,
                                'text': caption_text,
                                'timestamp': datetime.now()
                            }
            except:
                continue
                
    except Exception as e:
        print(f"Error extracting captions: {e}")
    
    return captions


def log_caption_update(meeting_id, speaker, text, is_new=True):
    """Log a caption update without clearing the terminal."""
    timestamp = datetime.now().strftime('%H:%M:%S')
    status = "NEW" if is_new else "UPD"
    print(f"[{timestamp}] [CAPTURE] [{status}] {speaker}: {text}")


def log_meeting_stats(db, meeting_id):
    """Log meeting statistics."""
    stats = db.get_meeting_stats(meeting_id)
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] [CAPTURE] Total: {stats['caption_count']} captions, {len(stats['participants'])} participants")


def sanitize_filename(title):
    """Convert window title to a safe filename."""
    # Remove invalid filename characters
    safe_title = title.replace('|', '-').replace(':', '').replace('/', '-').replace('\\', '-')
    safe_title = ''.join(c for c in safe_title if c.isalnum() or c in (' ', '-', '_'))
    # Limit length and remove extra spaces
    safe_title = ' '.join(safe_title.split())[:100]
    return safe_title


def export_to_markdown(db, meeting_id, filename):
    """Export meeting transcript to markdown file."""
    try:
        # Get all data from database
        stats = db.get_meeting_stats(meeting_id)
        all_captions = db.get_all_captions(meeting_id)
        
        if not all_captions:
            return None
        
        # Calculate duration
        duration = ""
        if stats['start_time'] and stats['end_time']:
            start = datetime.fromisoformat(stats['start_time']) if isinstance(stats['start_time'], str) else stats['start_time']
            end = datetime.fromisoformat(stats['end_time']) if isinstance(stats['end_time'], str) else stats['end_time']
            duration_sec = (end - start).total_seconds()
            duration_min = int(duration_sec / 60)
            duration = f"{duration_min} minutes" if duration_min > 0 else "< 1 minute"
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"# Teams Transcript\n\n")
            f.write(f"**Meeting:** {stats['meeting_name']}\n\n")
            f.write(f"**Captured:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Participants section
            f.write(f"**Participants ({len(stats['participants'])}):**\n\n")
            for participant in sorted(stats['participants']):
                f.write(f"- {participant}\n")
            f.write("\n")
            
            # Stats section
            f.write(f"**Stats:**\n\n")
            f.write(f"- Total captions: {stats['caption_count']}\n")
            if stats['start_time']:
                start_display = datetime.fromisoformat(stats['start_time']).strftime('%H:%M:%S') if isinstance(stats['start_time'], str) else stats['start_time'].strftime('%H:%M:%S')
                f.write(f"- Start time: {start_display}\n")
            if stats['end_time']:
                end_display = datetime.fromisoformat(stats['end_time']).strftime('%H:%M:%S') if isinstance(stats['end_time'], str) else stats['end_time'].strftime('%H:%M:%S')
                f.write(f"- End time: {end_display}\n")
            if duration:
                f.write(f"- Duration: {duration}\n")
            f.write("\n")
            
            f.write("---\n\n")
            
            # Consolidate consecutive captions from same speaker
            current_speaker = None
            current_timestamp = None
            current_texts = []
            
            for runtime_id, speaker, text, timestamp_str in all_captions:
                # Parse timestamp
                if isinstance(timestamp_str, str):
                    ts = datetime.fromisoformat(timestamp_str)
                else:
                    ts = timestamp_str
                timestamp_display = ts.strftime('%H:%M:%S')
                
                if speaker == current_speaker:
                    # Same speaker, accumulate text
                    current_texts.append(text)
                else:
                    # Different speaker, write previous and start new
                    if current_speaker is not None:
                        f.write(f"**[{current_timestamp}] {current_speaker}:**\n\n")
                        for txt in current_texts:
                            f.write(f"> {txt}\n\n")
                    
                    current_speaker = speaker
                    current_timestamp = timestamp_display
                    current_texts = [text]
            
            # Write the last speaker's captions
            if current_speaker is not None:
                f.write(f"**[{current_timestamp}] {current_speaker}:**\n\n")
                for txt in current_texts:
                    f.write(f"> {txt}\n\n")
        
        return filename
    except Exception as e:
        print(f"Error exporting to markdown: {e}")
        return None


def export_worker(db, meeting_id, filename, stop_event, export_interval=30):
    """Background thread that exports transcript to markdown periodically."""
    last_export = time.time()
    last_caption_count = 0
    
    while not stop_event.is_set():
        try:
            current_time = time.time()
            
            # Export every N seconds if there are new captions
            if current_time - last_export >= export_interval:
                stats = db.get_meeting_stats(meeting_id)
                
                # Only export if there are new captions
                if stats['caption_count'] > last_caption_count:
                    result = export_to_markdown(db, meeting_id, filename)
                    if result:
                        last_caption_count = stats['caption_count']
                        last_export = current_time
                else:
                    # Reset timer even if no new captions
                    last_export = current_time
            
            # Sleep briefly
            time.sleep(1)
            
        except Exception as e:
            print(f"[CAPTURE] Error in export worker: {e}")
            time.sleep(5)


def main():
    print("[CAPTURE] Starting Teams Caption Monitor...")
    print("[CAPTURE] Looking for Teams meeting window...")
    
    # Initialize database
    db = TranscriptDatabase()
    
    # State variables
    current_meeting_id = None
    current_meeting_name = None
    transcript_filename = None
    iteration = 0
    export_thread = None
    stop_export = None
    main.last_stats_log = 0  # Track last stats log time
    main.last_caption_count = 0  # Track caption count for stats logging
    
    try:
        while True:
            iteration += 1
            
            # Find Teams window with live captions enabled
            teams_window = get_teams_window_with_captions()
            if not teams_window:
                if iteration % 10 == 0:  # Print less frequently
                    print("[CAPTURE] Waiting for Teams meeting window with Live Captions enabled...")
                time.sleep(5)
                continue
            
            # Check meeting name
            try:
                window_title = teams_window.window_text()
            except:
                window_title = "Teams Meeting"
            
            # Get Live Captions group (we know it exists from find)
            live_captions = get_live_captions_group(teams_window)
            if not live_captions:
                # Captions disappeared, loop back to find another window
                time.sleep(5)
                continue
            
            # Only create meeting record when we have live captions AND window changed
            if current_meeting_name != window_title:
                # Stop previous export thread if exists
                if export_thread and stop_export:
                    print(f"[CAPTURE] Meeting changed - finalizing previous transcript...")
                    stop_export.set()
                    export_thread.join(timeout=5)
                    
                    # Final export of previous meeting
                    if ENABLE_MARKDOWN_EXPORT and current_meeting_id and transcript_filename:
                        export_to_markdown(db, current_meeting_id, transcript_filename)
                        print(f"[CAPTURE] Saved: {transcript_filename}")
                
                # Find or create meeting (only now that we confirmed live captions exist)
                safe_name = sanitize_filename(window_title)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                meeting_display_name = window_title[:80] + "..." if len(window_title) > 80 else window_title
                
                window_id = teams_window.handle
                
                # Check if this meeting already exists in database
                existing_meeting_id = db.find_meeting_by_window(window_id, meeting_display_name)
                
                if existing_meeting_id:
                    current_meeting_id = existing_meeting_id
                    print(f"[CAPTURE] Reconnected to existing meeting (ID: {current_meeting_id})")
                else:
                    current_meeting_id = db.create_meeting(meeting_display_name, window_title, window_id)
                    print(f"[CAPTURE] Started new meeting (ID: {current_meeting_id})")
                
                current_meeting_name = window_title
                transcript_filename = f"{safe_name}_{timestamp}.md"
                
                print(f"[CAPTURE] Meeting: {meeting_display_name}")
                if ENABLE_MARKDOWN_EXPORT:
                    print(f"[CAPTURE] Transcript file: {transcript_filename}")
                print(f"[CAPTURE] Database: transcripts.db (meeting_id: {current_meeting_id})")
                
                # Start new export thread only if markdown export is enabled
                if ENABLE_MARKDOWN_EXPORT:
                    stop_export = threading.Event()
                    export_thread = threading.Thread(
                        target=export_worker,
                        args=(db, current_meeting_id, transcript_filename, stop_export, 30),
                        daemon=True
                    )
                    export_thread.start()
            
            # Extract current captions
            current_captions = extract_captions(live_captions)
            
            # Process and store captions
            new_or_changed = 0
            last_stats_log = getattr(main, 'last_stats_log', 0)
            
            for runtime_id, caption_data in current_captions.items():
                speaker = caption_data['speaker']
                text = caption_data['text']
                timestamp = caption_data['timestamp']
                
                # Check if caption exists
                is_new = not db.caption_exists(current_meeting_id, runtime_id)
                
                if is_new:
                    # New caption
                    db.insert_or_update_caption(current_meeting_id, runtime_id, speaker, text, timestamp)
                    db.update_meeting_activity(current_meeting_id)
                    log_caption_update(current_meeting_id, speaker, text, is_new=True)
                    new_or_changed += 1
                else:
                    # Existing caption - update if text changed
                    db.insert_or_update_caption(current_meeting_id, runtime_id, speaker, text, timestamp)
            
            # Log stats every 30 seconds if there are changes
            current_time = time.time()
            if current_time - last_stats_log > 30:
                stats = db.get_meeting_stats(current_meeting_id)
                current_count = stats['caption_count']
                last_count = getattr(main, 'last_caption_count', 0)
                
                # Only log if caption count has changed
                if current_count != last_count:
                    log_meeting_stats(db, current_meeting_id)
                    main.last_caption_count = current_count
                
                main.last_stats_log = current_time
            
            # Wait 500ms
            time.sleep(0.5)
            
    except KeyboardInterrupt:
        print("[CAPTURE] Stopping caption monitor...")
        
        # Stop export thread
        if export_thread and stop_export:
            stop_export.set()
            export_thread.join(timeout=5)
        
        # Final export only if enabled
        if ENABLE_MARKDOWN_EXPORT and current_meeting_id and transcript_filename:
            print("[CAPTURE] Saving final transcript...")
            result = export_to_markdown(db, current_meeting_id, transcript_filename)
            if result:
                print(f"[CAPTURE] Final transcript saved to {transcript_filename}")
        
        db.close()
        print("[CAPTURE] Database closed.")
        
    except Exception as e:
        print(f"[CAPTURE] Error in main loop: {e}")
        import traceback
        traceback.print_exc()
        
        if db:
            db.close()


if __name__ == "__main__":
    main()
