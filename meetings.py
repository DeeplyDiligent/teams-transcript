#!/usr/bin/env python3
"""
Teams Meeting Transcript Tool

Usage:
  python meetings.py search <query>           # Find meetings matching a query
  python meetings.py transcript <id> [id...]  # Print full transcript(s) for meeting IDs
"""

import sys
import sqlite3
import textwrap
from pathlib import Path

DB_PATH = Path(__file__).parent / "transcripts.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def search_meetings(query: str):
    """Find meetings where the name or any caption text/speaker matches the query."""
    conn = get_conn()
    q = f"%{query}%"

    # Search meeting names first
    rows = conn.execute(
        """
        SELECT DISTINCT m.meeting_id, m.meeting_name, m.start_time
        FROM meetings m
        WHERE m.meeting_name LIKE ?
        ORDER BY m.start_time DESC
        """,
        (q,),
    ).fetchall()

    # Also search captions (speaker names and spoken text)
    caption_rows = conn.execute(
        """
        SELECT DISTINCT m.meeting_id, m.meeting_name, m.start_time
        FROM meetings m
        JOIN captions c ON c.meeting_id = m.meeting_id
        WHERE c.speaker LIKE ? OR c.text LIKE ?
        ORDER BY m.start_time DESC
        """,
        (q, q),
    ).fetchall()

    # Merge, deduplicate, keep order (name matches first)
    seen = set()
    results = []
    for row in list(rows) + list(caption_rows):
        if row["meeting_id"] not in seen:
            seen.add(row["meeting_id"])
            results.append(row)

    conn.close()

    if not results:
        print(f"No meetings found matching '{query}'.")
        return

    print(f"Found {len(results)} meeting(s) matching '{query}':\n")
    for r in results:
        ts = r["start_time"][:16].replace("T", " ")
        print(f"  [{r['meeting_id']:>4}]  {ts}  {r['meeting_name']}")
    print()
    print("To get a transcript:  python meetings.py transcript " + " ".join(str(r["meeting_id"]) for r in results))


def format_transcript(meeting_id: int, conn: sqlite3.Connection) -> str:
    meeting = conn.execute(
        "SELECT meeting_name, start_time FROM meetings WHERE meeting_id = ?",
        (meeting_id,),
    ).fetchone()

    if not meeting:
        return f"No meeting found with ID {meeting_id}."

    captions = conn.execute(
        """
        SELECT speaker, text, timestamp
        FROM captions
        WHERE meeting_id = ?
        ORDER BY timestamp
        """,
        (meeting_id,),
    ).fetchall()

    ts = meeting["start_time"][:16].replace("T", " ")
    header = f"{'='*70}\nMeeting: {meeting['meeting_name']}\nDate:    {ts}\nID:      {meeting_id}\n{'='*70}\n"

    if not captions:
        return header + "(No captions recorded)\n"

    lines = []
    prev_speaker = None
    buffer = []

    def flush():
        if buffer:
            joined = " ".join(buffer)
            # Word-wrap long lines with speaker indent
            wrapped = textwrap.fill(
                joined,
                width=100,
                initial_indent="",
                subsequent_indent="  ",
            )
            lines.append(f"{prev_speaker}: {wrapped}")

    for cap in captions:
        speaker = cap["speaker"] or "Unknown"
        text = (cap["text"] or "").strip()
        if not text:
            continue

        if speaker == prev_speaker:
            # Same speaker continuing — deduplicate incremental TTS updates
            if buffer and text.startswith(buffer[-1]):
                buffer[-1] = text  # replace with latest (longer) version
            else:
                buffer.append(text)
        else:
            flush()
            prev_speaker = speaker
            buffer = [text]

    flush()

    return header + "\n".join(lines) + "\n"


def format_action_items(meeting_id: int, conn: sqlite3.Connection) -> str:
    items = conn.execute(
        """
        SELECT action_id, parent_id, title, checked, sort_order
        FROM action_items
        WHERE meeting_id = ?
        ORDER BY sort_order, action_id
        """,
        (meeting_id,),
    ).fetchall()

    if not items:
        return ""

    # Build a dict and separate top-level from children
    by_id = {row["action_id"]: row for row in items}
    children: dict[int | None, list] = {}
    for row in items:
        parent = row["parent_id"]
        children.setdefault(parent, []).append(row)

    def render(parent_id, indent=0):
        lines = []
        for row in children.get(parent_id, []):
            tick = "x" if row["checked"] else " "
            prefix = "  " * indent
            lines.append(f"{prefix}  [{tick}] {row['title']}")
            lines.extend(render(row["action_id"], indent + 1))
        return lines

    section_lines = ["\n" + "-" * 70, "Action Items:", "-" * 70]
    section_lines.extend(render(None))
    return "\n".join(section_lines) + "\n"


def print_transcripts(meeting_ids: list[int]):
    conn = get_conn()
    for mid in meeting_ids:
        transcript = format_transcript(mid, conn)
        action_items = format_action_items(mid, conn)
        print(transcript + action_items)
    conn.close()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "search":
        query = " ".join(sys.argv[2:])
        search_meetings(query)

    elif command == "transcript":
        try:
            ids = [int(x) for x in sys.argv[2:]]
        except ValueError:
            print("Error: meeting IDs must be integers.")
            sys.exit(1)
        print_transcripts(ids)

    else:
        print(f"Unknown command '{command}'. Use 'search' or 'transcript'.")
        sys.exit(1)


if __name__ == "__main__":
    main()
