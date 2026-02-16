"""
Flask API for Teams Transcript Viewer
Provides REST endpoints to access meeting transcripts from SQLite database.
"""

import os
import time
import json
import asyncio
import sys
from flask import Flask, jsonify, send_from_directory, Response, request
from flask_cors import CORS
import sqlite3
from datetime import datetime

DB_PATH = 'transcripts.db'

# AI Backend Configuration
AI_BACKEND = os.getenv('AI_BACKEND', 'copilot')  # 'copilot' or 'azure'
AZURE_OPENAI_ENDPOINT = os.getenv('AZURE_OPENAI_ENDPOINT', '')
AZURE_OPENAI_KEY = os.getenv('AZURE_OPENAI_KEY', '')


def create_app(static_folder='frontend/dist'):
    """Create and configure the Flask app."""
    app = Flask(__name__, static_folder=static_folder)
    CORS(app)  # Enable CORS for React frontend
    
    def get_db_connection():
        """Create a database connection."""
        conn = sqlite3.connect(DB_PATH)
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
                meetings.append({
                    'meeting_id': row['meeting_id'],
                    'meeting_name': row['meeting_name'],
                    'window_title': row['window_title'],
                    'start_time': row['start_time'],
                    'last_activity': row['last_activity'],
                    'created_at': row['created_at'],
                    'caption_count': row['caption_count']
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

    @app.route('/api/meetings/<int:meeting_id>/captions', methods=['GET'])
    def get_captions(meeting_id):
        """Stream captions for a meeting using Server-Sent Events."""
        def generate():
            last_caption_id = 0
            seen_captions = {}  # Track caption_id -> updated_at
            
            # Send initial batch of all captions
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT 
                        caption_id,
                        meeting_id,
                        runtime_id,
                        speaker,
                        text,
                        timestamp,
                        created_at,
                        updated_at
                    FROM captions
                    WHERE meeting_id = ?
                    ORDER BY timestamp ASC
                ''', (meeting_id,))
                
                rows = cursor.fetchall()
                conn.close()
                
                if rows:
                    # Send all existing captions as initial data
                    captions = []
                    for row in rows:
                        caption = {
                            'caption_id': row['caption_id'],
                            'meeting_id': row['meeting_id'],
                            'runtime_id': row['runtime_id'],
                            'speaker': row['speaker'],
                            'text': row['text'],
                            'timestamp': row['timestamp'],
                            'created_at': row['created_at'],
                            'updated_at': row['updated_at']
                        }
                        captions.append(caption)
                        last_caption_id = max(last_caption_id, row['caption_id'])
                        seen_captions[row['caption_id']] = row['updated_at']
                    
                    # Send initial batch
                    yield f"data: {json.dumps({'type': 'initial', 'captions': captions})}\n\n"
                else:
                    # No captions yet, send empty initial
                    yield f"data: {json.dumps({'type': 'initial', 'captions': []})}\n\n"
                
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return
            
            # Poll for new captions every 500ms
            while True:
                try:
                    time.sleep(0.5)
                    
                    conn = get_db_connection()
                    cursor = conn.cursor()
                    
                    # Get new captions and updated captions
                    cursor.execute('''
                        SELECT 
                            caption_id,
                            meeting_id,
                            runtime_id,
                            speaker,
                            text,
                            timestamp,
                            created_at,
                            updated_at
                        FROM captions
                        WHERE meeting_id = ?
                        ORDER BY caption_id ASC
                    ''', (meeting_id,))
                    
                    rows = cursor.fetchall()
                    conn.close()
                    
                    # Check for new and updated captions
                    for row in rows:
                        caption_id = row['caption_id']
                        updated_at = row['updated_at']
                        
                        # New caption
                        if caption_id > last_caption_id:
                            caption = {
                                'caption_id': row['caption_id'],
                                'meeting_id': row['meeting_id'],
                                'runtime_id': row['runtime_id'],
                                'speaker': row['speaker'],
                                'text': row['text'],
                                'timestamp': row['timestamp'],
                                'created_at': row['created_at'],
                                'updated_at': row['updated_at']
                            }
                            last_caption_id = caption_id
                            seen_captions[caption_id] = updated_at
                            yield f"data: {json.dumps({'type': 'caption', 'caption': caption})}\n\n"
                        
                        # Updated caption (same ID but different updated_at)
                        elif caption_id in seen_captions and seen_captions[caption_id] != updated_at:
                            caption = {
                                'caption_id': row['caption_id'],
                                'meeting_id': row['meeting_id'],
                                'runtime_id': row['runtime_id'],
                                'speaker': row['speaker'],
                                'text': row['text'],
                                'timestamp': row['timestamp'],
                                'created_at': row['created_at'],
                                'updated_at': row['updated_at']
                            }
                            seen_captions[caption_id] = updated_at
                            yield f"data: {json.dumps({'type': 'update', 'caption': caption})}\n\n"
                    
                    # Send keepalive ping every 30 seconds of no activity
                    if not rows:
                        yield f": keepalive\n\n"
                    
                except GeneratorExit:
                    break
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    break
        
        return Response(generate(), mimetype='text/event-stream')

    @app.route('/api/meetings/<int:meeting_id>/chat', methods=['POST'])
    def chat_with_meeting(meeting_id):
        """Chat with AI about a meeting transcript using configured backend."""
        try:
            data = request.json
            user_message = data.get('message', '')
            
            if not user_message:
                return jsonify({'error': 'Message is required'}), 400
            
            # Get all captions for context
            conn = get_db_connection()
            cursor = conn.cursor()
            
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
            
            # Get chat history for conversation context
            cursor.execute('''
                SELECT role, content, timestamp
                FROM chat_messages
                WHERE meeting_id = ?
                ORDER BY timestamp ASC
            ''', (meeting_id,))
            
            chat_history = cursor.fetchall()
            conn.close()
            
            # Build system prompt
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


def run_api(port=5000, debug=False):
    """Run the Flask API server."""
    app = create_app()
    
    # Only print startup messages in the reloader subprocess or when not in debug mode
    import os
    is_reloader = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
    
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
