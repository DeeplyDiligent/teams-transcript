"""
Flask API for Teams Transcript Viewer
Provides REST endpoints to access meeting transcripts from SQLite database.
"""

import os
import time
import json
import asyncio
import sys
import tracemalloc
from flask import Flask, jsonify, send_from_directory, Response, request
from flask_cors import CORS
import sqlite3
from datetime import datetime, timedelta
from caption_stream import get_caption_stream_service

try:
    import psutil
except ImportError:
    psutil = None

DB_PATH = 'transcripts.db'
BACKUP_DIR = r'C:\GitHub\work-and-personal-notes-gdrive'
BACKUP_FILENAME = 'transcripts-latest.db'
BACKUP_INTERVAL_SECONDS = 30

# AI Backend Configuration
AI_BACKEND = os.getenv('AI_BACKEND', 'copilot')  # 'copilot' or 'azure'
AZURE_OPENAI_ENDPOINT = os.getenv('AZURE_OPENAI_ENDPOINT', '')
AZURE_OPENAI_KEY = os.getenv('AZURE_OPENAI_KEY', '')


def create_app(static_folder='frontend/dist', db_path=None, caption_stream_service=None):
    """Create and configure the Flask app."""
    app_db_path = db_path or DB_PATH
    app = Flask(__name__, static_folder=static_folder)
    CORS(app)  # Enable CORS for React frontend
    caption_streams = (
        caption_stream_service
        or get_caption_stream_service(app_db_path)
    )
    app.extensions['caption_streams'] = caption_streams
    
    def get_db_connection():
        """Create a database connection."""
        conn = sqlite3.connect(app_db_path)
        conn.row_factory = sqlite3.Row  # Return rows as dictionaries
        return conn

    @app.route('/api/meetings', methods=['GET'])
    def get_meetings():
        """Get all meetings."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT 
                    meeting_id,
                    meeting_name,
                    window_title,
                    start_time,
                    last_activity,
                    created_at,
                    (SELECT COUNT(*) FROM captions WHERE captions.meeting_id = meetings.meeting_id) as caption_count
                FROM meetings
                ORDER BY start_time DESC
            ''')
            
            meetings = []
            for row in cursor.fetchall():
                # Get unique speakers for this meeting
                cursor.execute('''
                    SELECT DISTINCT speaker
                    FROM captions
                    WHERE meeting_id = ?
                    ORDER BY speaker
                ''', (row['meeting_id'],))
                speakers = [speaker_row['speaker'] for speaker_row in cursor.fetchall()]
                
                meetings.append({
                    'meeting_id': row['meeting_id'],
                    'meeting_name': row['meeting_name'],
                    'window_title': row['window_title'],
                    'start_time': row['start_time'],
                    'last_activity': row['last_activity'],
                    'created_at': row['created_at'],
                    'caption_count': row['caption_count'],
                    'speakers': speakers
                })
            
            conn.close()
            return jsonify(meetings)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>', methods=['GET'])
    def get_meeting(meeting_id):
        """Get a specific meeting."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT 
                    meeting_id,
                    meeting_name,
                    window_title,
                    start_time,
                    last_activity,
                    created_at
                FROM meetings
                WHERE meeting_id = ?
            ''', (meeting_id,))
            
            row = cursor.fetchone()
            if not row:
                conn.close()
                return jsonify({'error': 'Meeting not found'}), 404
            
            meeting = {
                'meeting_id': row['meeting_id'],
                'meeting_name': row['meeting_name'],
                'window_title': row['window_title'],
                'start_time': row['start_time'],
                'last_activity': row['last_activity'],
                'created_at': row['created_at']
            }
            
            conn.close()
            return jsonify(meeting)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>', methods=['PUT'])
    def update_meeting(meeting_id):
        """Update meeting details (name)."""
        try:
            data = request.get_json()
            if not data or 'meeting_name' not in data:
                return jsonify({'error': 'meeting_name is required'}), 400
            
            meeting_name = data['meeting_name'].strip()
            if not meeting_name:
                return jsonify({'error': 'meeting_name cannot be empty'}), 400
            
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Check if meeting exists
            cursor.execute('SELECT meeting_id FROM meetings WHERE meeting_id = ?', (meeting_id,))
            if not cursor.fetchone():
                conn.close()
                return jsonify({'error': 'Meeting not found'}), 404
            
            # Update meeting name
            cursor.execute('''
                UPDATE meetings 
                SET meeting_name = ?
                WHERE meeting_id = ?
            ''', (meeting_name, meeting_id))
            
            conn.commit()
            conn.close()
            
            return jsonify({
                'success': True,
                'meeting_id': meeting_id,
                'meeting_name': meeting_name
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>/captions', methods=['GET'])
    def get_captions(meeting_id):
        """Stream captions for a meeting using Server-Sent Events."""
        # Get optional limit parameter
        limit = request.args.get('limit')
        caption_limit = None
        if limit:
            try:
                caption_limit = max(1, min(int(limit), 1000))
            except ValueError:
                caption_limit = None
        
        def generate():
            with caption_streams.stream(meeting_id):
                try:
                    captions, change_id = caption_streams.initial_snapshot(
                        meeting_id,
                        caption_limit,
                    )
                    yield "retry: 3000\n"
                    yield f"data: {json.dumps({'type': 'initial', 'captions': captions})}\n\n"
                except sqlite3.Error as exc:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
                    return

                deadline = time.monotonic() + caption_streams.max_stream_seconds
                while time.monotonic() < deadline:
                    try:
                        changes, change_id = caption_streams.changes_since(
                            meeting_id,
                            change_id,
                        )
                        if changes:
                            for change in changes:
                                operation = change.pop('operation')
                                change.pop('change_id')
                                event_type = 'caption' if operation == 'insert' else 'update'
                                yield f"data: {json.dumps({'type': event_type, 'caption': change})}\n\n"
                            continue

                        changed = caption_streams.wait_for_change(
                            change_id,
                            caption_streams.heartbeat_seconds,
                        )
                        if not changed:
                            yield f": heartbeat {int(time.time())}\n\n"
                    except GeneratorExit:
                        return
                    except sqlite3.Error as exc:
                        yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
                        return

                yield "event: reconnect\ndata: {}\n\n"
        
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        )

    @app.route('/api/meetings/<int:meeting_id>/chat', methods=['POST'])
    def chat_with_meeting(meeting_id):
        """Chat with AI about a meeting transcript using configured backend."""
        try:
            data = request.json
            user_message = data.get('message', '')
            no_save = request.args.get('no_save', 'false').lower() == 'true'
            limit = request.args.get('limit')  # Optional: limit to last N captions
            
            if not user_message:
                return jsonify({'error': 'Message is required'}), 400
            
            # Get all captions for context
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Build query with optional caption limit
            if limit:
                try:
                    caption_limit = int(limit)
                    # Get the last N captions
                    cursor.execute('''
                        SELECT speaker, text, timestamp
                        FROM captions
                        WHERE meeting_id = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    ''', (meeting_id, caption_limit))
                    captions = cursor.fetchall()
                    # Reverse to get chronological order
                    captions = list(reversed(captions))
                    
                    # If no captions found, fall back to all captions
                    if not captions:
                        cursor.execute('''
                            SELECT speaker, text, timestamp
                            FROM captions
                            WHERE meeting_id = ?
                            ORDER BY timestamp ASC
                        ''', (meeting_id,))
                        captions = cursor.fetchall()
                except ValueError:
                    # Invalid limit, get all
                    cursor.execute('''
                        SELECT speaker, text, timestamp
                        FROM captions
                        WHERE meeting_id = ?
                        ORDER BY timestamp ASC
                    ''', (meeting_id,))
                    captions = cursor.fetchall()
            else:
                cursor.execute('''
                    SELECT speaker, text, timestamp
                    FROM captions
                    WHERE meeting_id = ?
                    ORDER BY timestamp ASC
                ''', (meeting_id,))
                captions = cursor.fetchall()
            
            if not captions:
                conn.close()
                return jsonify({'error': 'No captions found for this meeting'}), 404
            
            # Build transcript context
            transcript_text = []
            last_speaker = None
            current_texts = []
            
            for row in captions:
                speaker = row['speaker']
                text = row['text']
                
                if speaker == last_speaker:
                    # Same speaker, accumulate text
                    current_texts.append(text)
                else:
                    # Different speaker, flush previous
                    if last_speaker is not None:
                        transcript_text.append(f"{last_speaker}: {' '.join(current_texts)}")
                    last_speaker = speaker
                    current_texts = [text]
            
            # Flush the last speaker
            if last_speaker is not None:
                transcript_text.append(f"{last_speaker}: {' '.join(current_texts)}")
            
            transcript_context = "\n".join(transcript_text)
            
            # Get chat history for conversation context (skip if no_save mode)
            chat_history = []
            if not no_save:
                cursor.execute('''
                    SELECT role, content, timestamp
                    FROM chat_messages
                    WHERE meeting_id = ?
                    ORDER BY timestamp ASC
                ''', (meeting_id,))
                chat_history = cursor.fetchall()
            
            conn.close()
            
            # Build system prompt based on mode
            if no_save:
                # Live mode: focused on suggesting what to say next
                system_prompt = f"""You are Deep Bhattacharyya's AI assistant helping him respond in real-time during a Teams meeting. Here is the recent conversation between him and someone else:

{transcript_context}

Deep is asking "What should I say next?" 

Spilt each response into this template:

# Suggested Response

[Your suggested response to the customer's question(s) goes here. Be concise and actionable, as if you are giving Deep a quick script to say next in the meeting.]

# Discovery Questions

[List any discovery questions Deep should ask the customer to better understand their needs. Be specific and relevant to the conversation.]

Use dot points and be clear and concise. Bold certain text thats important to emphasize. Do not include any reasoning or explanation - just give the final output in the format above.

"""
            else:
                # Regular chat mode: detailed analysis
                system_prompt = f"""My name is Deep Bhattacharyya. You are analyzing a Teams meeting transcript between me and others. Here is the full transcript:

{transcript_context}

Please provide helpful and detailed answers based on the transcript above. Make sure its nicely markdown formatted and use headings and dot points unless the user explicitly says what format they want. Do not reason - go directly to your answer. Give a direct answer without explaining your reasoning. Provide only the final output."""
            
            def generate_with_copilot():
                """Generate response using GitHub Copilot SDK."""
                try:
                    # Import copilot here to avoid startup errors if not installed
                    from copilot import CopilotClient
                    from copilot.generated.session_events import SessionEventType
                    import queue
                    import threading
                    
                    # Build conversation for copilot
                    conversation = system_prompt
                    
                    # Add previous chat history
                    for msg in chat_history:
                        if msg['role'] == 'user':
                            conversation += f"\n\nUser: {msg['content']}"
                        elif msg['role'] == 'assistant':
                            conversation += f"\n\nAssistant: {msg['content']}"
                    
                    # Add current user message
                    conversation += f"\n\nUser: {user_message}\n\nAssistant:"
                    
                    # Queue to pass chunks from async to sync context
                    chunk_queue = queue.Queue()
                    
                    async def run_copilot():
                        client = CopilotClient()
                        await client.start()
                        
                        session = await client.create_session({
                            "model": "gpt-4o",
                            "streaming": True,
                        })
                        
                        def handle_event(event):
                            print(f"[CHAT] Event: {event.type}")
                            if event.type == SessionEventType.ASSISTANT_REASONING_DELTA:
                                reasoning = event.data.delta_content
                                if reasoning:
                                    chunk_queue.put(('reasoning', reasoning))
                            elif event.type == SessionEventType.ASSISTANT_MESSAGE_DELTA:
                                chunk = event.data.delta_content
                                if chunk:
                                    chunk_queue.put(('chunk', chunk))
                            elif event.type == SessionEventType.SESSION_IDLE:
                                chunk_queue.put(('done', None))
                        
                        session.on(handle_event)
                        
                        try:
                            await session.send_and_wait({"prompt": conversation})
                        except Exception as e:
                            chunk_queue.put(('error', str(e)))
                        
                        await client.stop()
                    
                    # Run the async copilot function in a thread
                    def run_async():
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        try:
                            loop.run_until_complete(run_copilot())
                        finally:
                            loop.close()
                            chunk_queue.put(('done', None))
                    
                    thread = threading.Thread(target=run_async, daemon=True)
                    thread.start()
                    
                    # Stream chunks as they arrive
                    while True:
                        try:
                            msg_type, content = chunk_queue.get(timeout=30)
                            
                            if msg_type == 'reasoning':
                                yield f"data: {json.dumps({'type': 'reasoning', 'content': content})}\n\n"
                            elif msg_type == 'chunk':
                                yield f"data: {json.dumps({'type': 'chunk', 'content': content})}\n\n"
                            elif msg_type == 'error':
                                yield f"data: {json.dumps({'type': 'error', 'message': content})}\n\n"
                                break
                            elif msg_type == 'done':
                                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                                break
                        except queue.Empty:
                            yield f"data: {json.dumps({'type': 'error', 'message': 'Request timeout'})}\n\n"
                            break
                    
                except ImportError as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'GitHub Copilot SDK not installed or import failed: {str(e)}. Run: pip install github-copilot-sdk'})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            
            def generate_with_azure():
                """Generate response using Azure OpenAI."""
                try:
                    import requests
                    
                    if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_KEY:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Azure OpenAI credentials not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY environment variables.'})}\n\n"
                        return
                    
                    # Build messages for Azure OpenAI
                    messages = [
                        {"role": "system", "content": system_prompt}
                    ]
                    
                    # Add chat history
                    for msg in chat_history:
                        messages.append({
                            "role": msg['role'],
                            "content": msg['content']
                        })
                    
                    # Add current user message
                    messages.append({
                        "role": "user",
                        "content": user_message
                    })
                    
                    # Make streaming request to Azure OpenAI
                    headers = {
                        'Content-Type': 'application/json',
                        'api-key': AZURE_OPENAI_KEY
                    }
                    
                    payload = {
                        'messages': messages,
                        'stream': True,
                        'temperature': 0.7
                    }
                    
                    response = requests.post(
                        AZURE_OPENAI_ENDPOINT,
                        headers=headers,
                        json=payload,
                        stream=True
                    )
                    
                    if response.status_code != 200:
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Azure OpenAI API error: {response.status_code} - {response.text}'})}\n\n"
                        return
                    
                    # Stream the response
                    for line in response.iter_lines():
                        if line:
                            line_str = line.decode('utf-8')
                            if line_str.startswith('data: '):
                                data_str = line_str[6:]  # Remove 'data: ' prefix
                                
                                if data_str.strip() == '[DONE]':
                                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                                    break
                                
                                try:
                                    chunk_data = json.loads(data_str)
                                    choices = chunk_data.get('choices', [])
                                    
                                    if choices:
                                        delta = choices[0].get('delta', {})
                                        content = delta.get('content', '')
                                        
                                        if content:
                                            yield f"data: {json.dumps({'type': 'chunk', 'content': content})}\n\n"
                                except json.JSONDecodeError:
                                    continue
                    
                except ImportError:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'requests library not installed. Run: pip install requests'})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            
            # Choose backend based on configuration
            if AI_BACKEND == 'azure':
                return Response(generate_with_azure(), mimetype='text/event-stream')
            else:  # default to copilot
                return Response(generate_with_copilot(), mimetype='text/event-stream')
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>/chat/history', methods=['GET'])
    def get_chat_history(meeting_id):
        """Get chat history for a meeting."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT 
                    message_id,
                    meeting_id,
                    role,
                    content,
                    timestamp
                FROM chat_messages
                WHERE meeting_id = ?
                ORDER BY timestamp ASC
            ''', (meeting_id,))
            
            messages = []
            for row in cursor.fetchall():
                messages.append({
                    'id': f"{row['role']}-{row['message_id']}",
                    'message_id': row['message_id'],
                    'meeting_id': row['meeting_id'],
                    'role': row['role'],
                    'content': row['content'],
                    'timestamp': row['timestamp']
                })
            
            conn.close()
            return jsonify(messages)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>/chat/save', methods=['POST'])
    def save_chat_message(meeting_id):
        """Save a chat message to the database."""
        try:
            data = request.json
            role = data.get('role')
            content = data.get('content')
            
            if not role or not content:
                return jsonify({'error': 'Role and content are required'}), 400
            
            if role not in ['user', 'assistant']:
                return jsonify({'error': 'Role must be user or assistant'}), 400
            
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO chat_messages (meeting_id, role, content)
                VALUES (?, ?, ?)
            ''', (meeting_id, role, content))
            
            message_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            return jsonify({
                'message_id': message_id,
                'success': True
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/meetings/<int:meeting_id>/chat/clear', methods=['DELETE'])
    def clear_chat_history(meeting_id):
        """Clear all chat messages for a meeting."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                DELETE FROM chat_messages
                WHERE meeting_id = ?
            ''', (meeting_id,))
            
            deleted_count = cursor.rowcount
            conn.commit()
            conn.close()
            
            return jsonify({
                'success': True,
                'deleted_count': deleted_count
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # ---- Action Items Endpoints ----

    def _ensure_actions_table(conn):
        """Ensure action_items table and actions_status column exist."""
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS action_items (
                action_id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                parent_id INTEGER,
                title TEXT NOT NULL,
                checked INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
                FOREIGN KEY (parent_id) REFERENCES action_items(action_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_action_meeting ON action_items(meeting_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_action_parent ON action_items(parent_id)')
        try:
            cursor.execute("PRAGMA table_info(meetings)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'actions_status' not in columns:
                cursor.execute('ALTER TABLE meetings ADD COLUMN actions_status TEXT')
        except Exception:
            pass
        conn.commit()

    @app.route('/api/actions', methods=['GET'])
    def get_all_actions():
        """Get all action items grouped by meeting."""
        try:
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            # Fetch all meetings
            cursor.execute('''
                SELECT m.meeting_id, m.meeting_name, m.actions_status, m.start_time
                FROM meetings m
                ORDER BY m.start_time DESC
            ''')
            meetings = cursor.fetchall()
            meeting_ids = [m['meeting_id'] for m in meetings]
            
            if not meeting_ids:
                conn.close()
                return jsonify([])
            
            # Batch fetch all actions
            placeholders = ','.join('?' * len(meeting_ids))
            cursor.execute(f'''
                SELECT action_id, meeting_id, parent_id, title, checked, sort_order
                FROM action_items
                WHERE meeting_id IN ({placeholders})
                ORDER BY sort_order ASC, action_id ASC
            ''', meeting_ids)
            all_actions = cursor.fetchall()
            
            # Group actions by meeting_id
            actions_by_meeting = {}
            for row in all_actions:
                mid = row['meeting_id']
                if mid not in actions_by_meeting:
                    actions_by_meeting[mid] = []
                actions_by_meeting[mid].append(dict(row))
            
            # Batch fetch all speakers
            cursor.execute(f'''
                SELECT meeting_id, speaker
                FROM (SELECT DISTINCT meeting_id, speaker FROM captions WHERE meeting_id IN ({placeholders}))
                ORDER BY speaker
            ''', meeting_ids)
            all_speakers = cursor.fetchall()
            
            # Group speakers by meeting_id
            speakers_by_meeting = {}
            for row in all_speakers:
                mid = row['meeting_id']
                if mid not in speakers_by_meeting:
                    speakers_by_meeting[mid] = []
                speakers_by_meeting[mid].append(row['speaker'])
            
            # Build result
            result = []
            for meeting in meetings:
                mid = meeting['meeting_id']
                result.append({
                    'meeting_id': mid,
                    'meeting_name': meeting['meeting_name'] or 'Untitled Meeting',
                    'actions_status': meeting['actions_status'],
                    'start_time': meeting['start_time'],
                    'speakers': speakers_by_meeting.get(mid, []),
                    'actions': actions_by_meeting.get(mid, [])
                })
            
            conn.close()
            return jsonify(result)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/<int:action_id>/toggle', methods=['PUT'])
    def toggle_action(action_id):
        """Toggle the checked state of an action item."""
        try:
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            cursor.execute('SELECT action_id, checked FROM action_items WHERE action_id = ?', (action_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                return jsonify({'error': 'Action not found'}), 404
            
            new_checked = 0 if row['checked'] else 1
            cursor.execute('UPDATE action_items SET checked = ? WHERE action_id = ?', (new_checked, action_id))
            # Recursively cascade to all descendants
            def cascade_children(aid):
                cursor.execute('SELECT action_id FROM action_items WHERE parent_id = ?', (aid,))
                for child in cursor.fetchall():
                    cursor.execute('UPDATE action_items SET checked = ? WHERE action_id = ?', (new_checked, child['action_id']))
                    cascade_children(child['action_id'])
            cascade_children(action_id)
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'action_id': action_id, 'checked': new_checked})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/<int:action_id>', methods=['PUT'])
    def update_action(action_id):
        """Update an action item's title."""
        try:
            data = request.json
            title = data.get('title', '').strip()
            if not title:
                return jsonify({'error': 'title is required'}), 400
            
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            cursor.execute('SELECT action_id FROM action_items WHERE action_id = ?', (action_id,))
            if not cursor.fetchone():
                conn.close()
                return jsonify({'error': 'Action not found'}), 404
            
            cursor.execute('UPDATE action_items SET title = ? WHERE action_id = ?', (title, action_id))
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'action_id': action_id, 'title': title})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/<int:action_id>', methods=['DELETE'])
    def delete_action(action_id):
        """Delete an action item and its children."""
        try:
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            cursor.execute('SELECT action_id FROM action_items WHERE action_id = ?', (action_id,))
            if not cursor.fetchone():
                conn.close()
                return jsonify({'error': 'Action not found'}), 404
            
            # Recursively collect all descendant IDs
            def get_descendants(aid):
                cursor.execute('SELECT action_id FROM action_items WHERE parent_id = ?', (aid,))
                children = [r['action_id'] for r in cursor.fetchall()]
                all_ids = list(children)
                for child_id in children:
                    all_ids.extend(get_descendants(child_id))
                return all_ids
            
            desc_ids = get_descendants(action_id)
            all_ids = [action_id] + desc_ids
            placeholders = ','.join('?' * len(all_ids))
            cursor.execute(f'DELETE FROM action_items WHERE action_id IN ({placeholders})', all_ids)
            conn.commit()
            conn.close()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/add', methods=['POST'])
    def add_action():
        """Add a new action item."""
        try:
            data = request.json
            meeting_id = data.get('meeting_id')
            title = data.get('title', '').strip()
            parent_id = data.get('parent_id')  # null for top-level
            after_action_id = data.get('after_action_id')  # insert after this action
            
            if not meeting_id or not title:
                return jsonify({'error': 'meeting_id and title required'}), 400
            
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            # Determine sort_order
            if after_action_id:
                cursor.execute('SELECT sort_order FROM action_items WHERE action_id = ?', (after_action_id,))
                row = cursor.fetchone()
                sort_order = (row['sort_order'] + 1) if row else 0
                # Shift subsequent items
                if parent_id:
                    cursor.execute(
                        'UPDATE action_items SET sort_order = sort_order + 1 WHERE meeting_id = ? AND parent_id = ? AND sort_order >= ?',
                        (meeting_id, parent_id, sort_order)
                    )
                else:
                    cursor.execute(
                        'UPDATE action_items SET sort_order = sort_order + 1 WHERE meeting_id = ? AND parent_id IS NULL AND sort_order >= ?',
                        (meeting_id, sort_order)
                    )
            else:
                # Add at end
                if parent_id:
                    cursor.execute(
                        'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM action_items WHERE meeting_id = ? AND parent_id = ?',
                        (meeting_id, parent_id)
                    )
                else:
                    cursor.execute(
                        'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM action_items WHERE meeting_id = ? AND parent_id IS NULL',
                        (meeting_id,)
                    )
                sort_order = cursor.fetchone()['next_order']
            
            cursor.execute(
                'INSERT INTO action_items (meeting_id, parent_id, title, sort_order) VALUES (?, ?, ?, ?)',
                (meeting_id, parent_id, title, sort_order)
            )
            action_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'action_id': action_id, 'sort_order': sort_order})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/reorder', methods=['PUT'])
    def reorder_actions():
        """Reorder actions by setting sort_order and optionally parent_id."""
        try:
            data = request.json
            items = data.get('items', [])  # [{action_id, sort_order, parent_id}]
            
            if not items:
                return jsonify({'error': 'items required'}), 400
            
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            for item in items:
                cursor.execute(
                    'UPDATE action_items SET sort_order = ?, parent_id = ? WHERE action_id = ?',
                    (item['sort_order'], item.get('parent_id'), item['action_id'])
                )
            
            conn.commit()
            conn.close()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/batch-toggle', methods=['PUT'])
    def batch_toggle_actions():
        """Set checked state for multiple actions at once."""
        try:
            data = request.json
            action_ids = data.get('action_ids', [])
            checked = data.get('checked', 1)
            
            if not action_ids:
                return jsonify({'error': 'action_ids required'}), 400
            
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            placeholders = ','.join('?' * len(action_ids))
            cursor.execute(
                f'UPDATE action_items SET checked = ? WHERE action_id IN ({placeholders})',
                [checked] + action_ids
            )
            
            updated = cursor.rowcount
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'updated': updated, 'checked': checked})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/regenerate/<int:meeting_id>', methods=['POST'])
    def regenerate_actions(meeting_id):
        """Delete existing actions and regenerate for a meeting."""
        try:
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()

            cursor.execute('SELECT meeting_id, actions_status FROM meetings WHERE meeting_id = ?', (meeting_id,))
            meeting = cursor.fetchone()
            if not meeting:
                conn.close()
                return jsonify({'error': 'Meeting not found'}), 404

            if meeting['actions_status'] == 'generating':
                conn.close()
                return jsonify({'error': 'Actions are currently generating'}), 400

            # Clear existing actions and reset status
            cursor.execute('DELETE FROM action_items WHERE meeting_id = ?', (meeting_id,))
            cursor.execute('UPDATE meetings SET actions_status = NULL WHERE meeting_id = ?', (meeting_id,))
            conn.commit()
            conn.close()

            # Reuse the generate endpoint logic
            return generate_actions(meeting_id)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/pending', methods=['GET'])
    def get_pending_meetings():
        """Get meetings that have finished but don't have actions generated yet."""
        try:
            conn = get_db_connection()
            _ensure_actions_table(conn)
            cursor = conn.cursor()
            
            # Find meetings where:
            # 1. actions_status is NULL (never processed)
            # 2. last caption is older than 1 minute (meeting finished)
            # 3. has at least some captions
            one_minute_ago = (datetime.now() - timedelta(minutes=1)).isoformat()
            
            cursor.execute('''
                SELECT m.meeting_id, m.meeting_name
                FROM meetings m
                WHERE m.actions_status IS NULL
                AND EXISTS (
                    SELECT 1 FROM captions c WHERE c.meeting_id = m.meeting_id
                )
                AND (
                    SELECT MAX(c.timestamp) FROM captions c WHERE c.meeting_id = m.meeting_id
                ) < ?
            ''', (one_minute_ago,))
            
            pending = [dict(row) for row in cursor.fetchall()]
            conn.close()
            
            return jsonify(pending)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/actions/generate/<int:meeting_id>', methods=['POST'])
    def generate_actions(meeting_id):
        """Generate action items for a meeting using the LLM."""
        try:
            import threading
            thread = threading.Thread(
                target=_generate_actions_for_meeting,
                args=(app_db_path, meeting_id),
                daemon=True
            )
            thread.start()
            return jsonify({'status': 'generating', 'meeting_id': meeting_id})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/memory', methods=['GET'])
    def get_memory_stats():
        """Get detailed memory usage statistics for diagnostics."""
        try:
            result = {}

            # Process-level memory via psutil
            if psutil:
                proc = psutil.Process(os.getpid())
                mem_info = proc.memory_info()
                result['process'] = {
                    'rss_mb': round(mem_info.rss / 1024 / 1024, 2),
                    'vms_mb': round(mem_info.vms / 1024 / 1024, 2),
                    'rss_bytes': mem_info.rss,
                    'num_threads': proc.num_threads(),
                    'open_files': len(proc.open_files()),
                }
                result['caption_streams'] = caption_streams.diagnostics()
                # System-wide memory
                vm = psutil.virtual_memory()
                result['system'] = {
                    'total_mb': round(vm.total / 1024 / 1024, 2),
                    'available_mb': round(vm.available / 1024 / 1024, 2),
                    'percent_used': vm.percent,
                }
            else:
                result['process'] = {'error': 'psutil not installed'}

            # tracemalloc snapshot
            if tracemalloc.is_tracing():
                snapshot = tracemalloc.take_snapshot()
                current, peak = tracemalloc.get_traced_memory()
                result['tracemalloc'] = {
                    'current_mb': round(current / 1024 / 1024, 2),
                    'peak_mb': round(peak / 1024 / 1024, 2),
                }
                # Top 15 memory allocations by file
                top_stats = snapshot.statistics('lineno')
                result['tracemalloc']['top_allocations'] = [
                    {
                        'file': str(stat.traceback),
                        'size_kb': round(stat.size / 1024, 2),
                        'count': stat.count,
                    }
                    for stat in top_stats[:15]
                ]
            else:
                result['tracemalloc'] = {'enabled': False, 'hint': 'Start app via main.py to enable tracemalloc'}

            # DB file size
            if os.path.exists(app_db_path):
                db_size = os.path.getsize(app_db_path)
                result['database'] = {
                    'file_mb': round(db_size / 1024 / 1024, 2),
                }
                # Row counts
                conn = get_db_connection()
                cursor = conn.cursor()
                for table in ['meetings', 'captions', 'chat_messages', 'action_items']:
                    try:
                        cursor.execute(f'SELECT COUNT(*) as c FROM {table}')
                        result['database'][f'{table}_rows'] = cursor.fetchone()['c']
                    except Exception:
                        pass
                conn.close()

            return jsonify(result)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/stats', methods=['GET'])
    def get_stats():
        """Get overall statistics."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get total meetings
            cursor.execute('SELECT COUNT(*) as count FROM meetings')
            meeting_count = cursor.fetchone()['count']
            
            # Get total captions
            cursor.execute('SELECT COUNT(*) as count FROM captions')
            caption_count = cursor.fetchone()['count']
            
            # Get unique speakers
            cursor.execute('SELECT COUNT(DISTINCT speaker) as count FROM captions')
            speaker_count = cursor.fetchone()['count']
            
            conn.close()
            
            return jsonify({
                'total_meetings': meeting_count,
                'total_captions': caption_count,
                'unique_speakers': speaker_count
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # Serve static files in production (if frontend build exists)
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_frontend(path):
        """Serve the React frontend (production build only)."""
        if path and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, 'index.html')
    
    return app


def _find_pending_meetings(db_path):
    """Find meetings that have finished but don't have actions generated yet."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    one_minute_ago = (datetime.now() - timedelta(minutes=1)).isoformat()
    cursor.execute('''
        SELECT m.meeting_id, m.meeting_name
        FROM meetings m
        WHERE m.actions_status IS NULL
        AND EXISTS (
            SELECT 1 FROM captions c WHERE c.meeting_id = m.meeting_id
        )
        AND (
            SELECT MAX(c.timestamp) FROM captions c WHERE c.meeting_id = m.meeting_id
        ) < ?
    ''', (one_minute_ago,))
    pending = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return pending


def _backup_database_snapshot(db_path, last_source_signature=None, backup_dir=BACKUP_DIR, backup_filename=BACKUP_FILENAME):
    """Create a consistent SQLite snapshot for Syncthing to sync. Skip if unchanged."""
    backup_path = os.path.join(backup_dir, backup_filename)
    source_conn = None
    backup_conn = None

    try:
        if not os.path.exists(db_path):
            print(f"[BACKUP] Source database not found: {db_path}")
            return False, last_source_signature

        current_signature = []
        for source_path in (db_path, f"{db_path}-wal", f"{db_path}-shm"):
            if os.path.exists(source_path):
                source_stat = os.stat(source_path)
                current_signature.append((source_path, source_stat.st_size, source_stat.st_mtime_ns))
        current_signature = tuple(current_signature)

        if current_signature == last_source_signature:
            return False, last_source_signature

        os.makedirs(backup_dir, exist_ok=True)

        source_conn = sqlite3.connect(os.path.abspath(db_path), timeout=10)
        backup_conn = sqlite3.connect(backup_path, timeout=10)

        with backup_conn:
            source_conn.backup(backup_conn)

        new_backup_size = os.path.getsize(backup_path)
        print(f"[BACKUP] Backup successful: {backup_path} ({new_backup_size} bytes)")
        return True, current_signature
    except Exception as e:
        print(f"[BACKUP] Backup failed: {e}")
        return False, last_source_signature
    finally:
        if backup_conn:
            backup_conn.close()
        if source_conn:
            source_conn.close()


def _actions_worker(db_path, check_interval=30):
    """Background thread that checks for pending meetings and auto-generates actions."""
    print(f"[ACTIONS] Background worker started (checking every {check_interval}s)")
    print(f"[BACKUP] Background backup enabled (every {BACKUP_INTERVAL_SECONDS}s -> {os.path.join(BACKUP_DIR, BACKUP_FILENAME)})")
    last_backup_time = 0.0
    last_backup_source_signature = None

    while True:
        try:
            # Unstick any meetings that have been 'generating' for more than 5 minutes
            try:
                conn = sqlite3.connect(db_path)
                five_min_ago = (datetime.now() - timedelta(minutes=5)).isoformat()
                conn.execute('''
                    UPDATE meetings SET actions_status = NULL
                    WHERE actions_status = 'generating'
                    AND last_activity < ?
                ''', (five_min_ago,))
                if conn.total_changes > 0:
                    print(f"[ACTIONS] Reset {conn.total_changes} stuck 'generating' meeting(s)")

                # Mark captionless meetings as 'no_actions'
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE meetings SET actions_status = 'no_actions'
                    WHERE actions_status IS NULL
                    AND NOT EXISTS (
                        SELECT 1 FROM captions WHERE captions.meeting_id = meetings.meeting_id
                    )
                ''')
                if cursor.rowcount > 0:
                    print(f"[ACTIONS] Marked {cursor.rowcount} captionless meeting(s) as no_actions")

                conn.commit()
                conn.close()
            except Exception as e:
                print(f"[ACTIONS] Error in housekeeping: {e}")

            pending = _find_pending_meetings(db_path)
            if pending:
                print(f"[ACTIONS] Found {len(pending)} pending meeting(s): {[m['meeting_id'] for m in pending]}")
                for meeting in pending:
                    mid = meeting['meeting_id']
                    mname = meeting.get('meeting_name', 'Unknown')
                    print(f"[ACTIONS] Auto-generating actions for meeting {mid}: {mname}")
                    try:
                        result = _generate_actions_for_meeting(db_path, mid)
                        print(f"[ACTIONS] Meeting {mid} result: {result}")
                    except Exception as e:
                        print(f"[ACTIONS] Error generating actions for meeting {mid}: {e}")
                        _update_actions_status(db_path, mid, None)  # Reset so it retries

            now = time.monotonic()
            if now - last_backup_time >= BACKUP_INTERVAL_SECONDS:
                _, last_backup_source_signature = _backup_database_snapshot(db_path, last_backup_source_signature)
                last_backup_time = now
        except Exception as e:
            print(f"[ACTIONS] Worker error: {e}")
        time.sleep(check_interval)


def _generate_actions_for_meeting(db_path, meeting_id):
    """Generate action items for a meeting (called from background worker or API)."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check meeting exists and isn't already generating
    cursor.execute('SELECT meeting_id, actions_status FROM meetings WHERE meeting_id = ?', (meeting_id,))
    meeting = cursor.fetchone()
    if not meeting:
        conn.close()
        return 'not_found'
    if meeting['actions_status'] == 'generating':
        conn.close()
        return 'already_generating'

    # Mark as generating
    cursor.execute('UPDATE meetings SET actions_status = ? WHERE meeting_id = ?', ('generating', meeting_id))
    conn.commit()

    # Get captions
    cursor.execute('''
        SELECT speaker, text, timestamp
        FROM captions
        WHERE meeting_id = ?
        ORDER BY timestamp ASC
    ''', (meeting_id,))
    captions = cursor.fetchall()

    if not captions:
        cursor.execute('UPDATE meetings SET actions_status = ? WHERE meeting_id = ?', ('no_actions', meeting_id))
        conn.commit()
        conn.close()
        return 'no_actions'

    # Build transcript
    transcript_text = []
    last_speaker = None
    current_texts = []
    for row in captions:
        speaker = row['speaker']
        text = row['text']
        if speaker == last_speaker:
            current_texts.append(text)
        else:
            if last_speaker is not None:
                transcript_text.append(f"{last_speaker}: {' '.join(current_texts)}")
            last_speaker = speaker
            current_texts = [text]
    if last_speaker is not None:
        transcript_text.append(f"{last_speaker}: {' '.join(current_texts)}")

    transcript_context = "\n".join(transcript_text)
    conn.close()

    system_prompt = f"""You are analyzing a Teams meeting transcript to extract action items specifically for Deep Bhattacharyya. Here is the transcript:

{transcript_context}

Extract action items that Deep Bhattacharyya needs to do based on this meeting. Only include actions that are relevant to Deep - things he committed to, was assigned, or needs to follow up on.

If there are NO action items for Deep Bhattacharyya in this transcript, return exactly: {{"actions": []}}

Otherwise return a JSON object with this structure:
{{
  "actions": [
    {{
      "title": "Action item description",
      "children": [
        {{"title": "Sub-action description"}}
      ]
    }},
    {{
      "title": "Another action item",
      "children": []
    }}
  ]
}}

Rules:
- Only return the JSON object, no other text or markdown
- children array can be empty if no sub-actions
- Be specific and actionable
- Only include actions for Deep Bhattacharyya"""

    try:
        full_response = ""

        if AI_BACKEND == 'azure':
            import requests as http_requests

            if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_KEY:
                _update_actions_status(db_path, meeting_id, 'no_actions')
                return 'no_credentials'

            headers = {
                'Content-Type': 'application/json',
                'api-key': AZURE_OPENAI_KEY
            }
            payload = {
                'messages': [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "Extract the action items for Deep Bhattacharyya from this meeting transcript. Return only JSON."}
                ],
                'temperature': 0.3
            }
            response = http_requests.post(AZURE_OPENAI_ENDPOINT, headers=headers, json=payload)
            if response.status_code == 200:
                data = response.json()
                full_response = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            else:
                print(f"[ACTIONS] Azure OpenAI error: {response.status_code}")
                _update_actions_status(db_path, meeting_id, 'no_actions')
                return 'api_error'
        else:
            # Copilot backend
            from copilot import CopilotClient
            from copilot.generated.session_events import SessionEventType
            import queue as q_module

            chunk_queue = q_module.Queue()

            async def run_copilot():
                client = CopilotClient()
                await client.start()
                session = await client.create_session({
                    "model": "gpt-4o",
                    "streaming": True,
                })

                def handle_event(event):
                    if event.type == SessionEventType.ASSISTANT_MESSAGE_DELTA:
                        chunk = event.data.delta_content
                        if chunk:
                            chunk_queue.put(('chunk', chunk))
                    elif event.type == SessionEventType.SESSION_IDLE:
                        chunk_queue.put(('done', None))

                session.on(handle_event)

                conversation = system_prompt + "\n\nUser: Extract the action items for Deep Bhattacharyya from this meeting transcript. Return only JSON.\n\nAssistant:"
                try:
                    await session.send_and_wait({"prompt": conversation})
                except Exception as e:
                    chunk_queue.put(('error', str(e)))

                await client.stop()

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(run_copilot())
            finally:
                loop.close()

            # Collect all chunks
            while True:
                try:
                    msg_type, content = chunk_queue.get(timeout=5)
                    if msg_type == 'chunk':
                        full_response += content
                    elif msg_type in ('done', 'error'):
                        break
                except Exception:
                    break

        # Parse the JSON response
        json_str = full_response.strip()
        if json_str.startswith('```'):
            lines = json_str.split('\n')
            json_lines = []
            in_block = False
            for line in lines:
                if line.strip().startswith('```'):
                    in_block = not in_block
                    continue
                if in_block or not line.strip().startswith('```'):
                    json_lines.append(line)
            json_str = '\n'.join(json_lines).strip()

        start_idx = json_str.find('{')
        end_idx = json_str.rfind('}')
        if start_idx != -1 and end_idx != -1:
            json_str = json_str[start_idx:end_idx + 1]

        actions_data = json.loads(json_str)
        actions_list = actions_data.get('actions', [])

        if not actions_list:
            _update_actions_status(db_path, meeting_id, 'no_actions')
            return 'no_actions'

        # Save actions to database
        conn2 = sqlite3.connect(db_path)
        conn2.row_factory = sqlite3.Row
        cursor2 = conn2.cursor()

        sort_order = 0
        for action in actions_list:
            cursor2.execute('''
                INSERT INTO action_items (meeting_id, parent_id, title, sort_order)
                VALUES (?, NULL, ?, ?)
            ''', (meeting_id, action['title'], sort_order))
            parent_id = cursor2.lastrowid
            sort_order += 1

            children = action.get('children', [])
            child_order = 0
            for child in children:
                cursor2.execute('''
                    INSERT INTO action_items (meeting_id, parent_id, title, sort_order)
                    VALUES (?, ?, ?, ?)
                ''', (meeting_id, parent_id, child['title'], child_order))
                child_order += 1

        cursor2.execute('UPDATE meetings SET actions_status = ? WHERE meeting_id = ?', ('done', meeting_id))
        conn2.commit()
        conn2.close()
        print(f"[ACTIONS] Generated {len(actions_list)} actions for meeting {meeting_id}")
        return 'done'

    except Exception as e:
        print(f"[ACTIONS] Error generating actions for meeting {meeting_id}: {e}")
        _update_actions_status(db_path, meeting_id, 'no_actions')
        return 'error'


def _update_actions_status(db_path, meeting_id, status):
    """Update actions_status for a meeting."""
    try:
        conn = sqlite3.connect(db_path)
        conn.execute('UPDATE meetings SET actions_status = ? WHERE meeting_id = ?', (status, meeting_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[ACTIONS] Error saving status: {e}")


def run_api(port=5000, debug=False):
    """Run the Flask API server."""
    import threading

    app = create_app()
    
    # Only print startup messages in the reloader subprocess or when not in debug mode
    import os
    is_reloader = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
    
    # Start background actions worker (only once — skip in debug main process)
    if not debug or is_reloader:
        worker = threading.Thread(
            target=_actions_worker,
            args=(DB_PATH,),
            daemon=True
        )
        worker.start()
    
    if not debug or is_reloader:
        # Check if frontend build exists
        has_frontend = os.path.exists('frontend/dist/index.html')
        
        if has_frontend:
            print(f"[API] Frontend: Production build (serving from /)")
        else:
            print(f"[API] Frontend: Dev mode (CORS enabled, run Vite separately)")
        
        print(f"[API] Server: http://localhost:{port}")
    
    # Run Flask
    app.run(debug=debug, port=port, host='0.0.0.0')


if __name__ == '__main__':
    run_api(debug=True)
