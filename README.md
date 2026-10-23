# Teams Transcript Viewer

A web application for viewing and searching Microsoft Teams meeting transcripts captured from live captions.

## Features

- 📊 **Dashboard** - View statistics about your meetings and transcripts
- 📝 **Meeting List** - Browse all captured meetings
- 🔍 **Search** - Search through transcript text and speakers
- 🤖 **AI Chat** - Ask questions about meeting transcripts (GitHub Copilot or Azure OpenAI)
- 🎨 **Color-coded Speakers** - Each speaker gets a unique color
- ⏱️ **Timestamps** - See when each caption was spoken
- 📱 **Responsive Design** - Works on desktop and mobile

## Architecture

- **Capture**: A single Teams UI Automation worker reads captions and persists
  each snapshot in one SQLite transaction. Unchanged captions are not rewritten.
- **Database**: SQLite in WAL mode is the source of truth. Insert/update triggers
  append lightweight records to a durable `caption_changes` journal.
- **Streaming**: One shared backend watcher monitors the journal and wakes all
  subscribers. Browser connections receive incremental changes rather than
  running their own database polling loops.
- **Connection lifecycle**: Caption streams send heartbeats every 15 seconds and
  expire after five minutes so disconnected clients are detected and resources
  remain bounded. Native `EventSource` reconnection creates the replacement.
- **Backend**: Flask provides REST APIs, bounded SSE streams, AI chat, and static
  frontend hosting.
- **Frontend**: React + Vite + Tailwind CSS uses one owned caption subscription
  per mounted view.

This architecture keeps database polling constant as browser count increases.
For multi-host deployment, the `caption_changes` journal can be replaced by an
external event broker without changing the frontend stream contract.

## Getting started

### Prerequisites

- Windows with Microsoft Teams installed for live caption capture
- Python 3
- Node.js 20.19+ or 22.12+ with npm

### Install and build

From the repository root, install the Python dependencies and build the frontend:

```bash
pip install -r requirements.txt
cd frontend
npm install
npm run build
cd ..
```

### Run the app

From the repository root:

```bash
python main.py
```

Open `http://localhost:5000` in your browser. This starts both the API and live caption capture. Flask serves the built frontend, so you do not need a separate frontend development server.

For later runs, just use `python main.py`. Rebuild with `npm run build` in `frontend` after changing frontend code.

### AI Chat Configuration (Optional)

The app supports two AI backends for chatting with meeting transcripts:

#### Option 1: GitHub Copilot SDK

1. Install the SDK:
```bash
pip install github-copilot-sdk
```

2. Set environment variable (or in `.env` file):
```
AI_BACKEND=copilot
```

3. Requires GitHub Copilot subscription

#### Option 2: Azure OpenAI

1. No additional dependencies needed (uses `requests` library)

2. Create a `.env` file with your credentials:
```
AI_BACKEND=azure
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-05-01-preview
AZURE_OPENAI_KEY=your-api-key-here
```

3. The `.env` file will be automatically loaded by `start.ps1`

**To switch backends:** Simply change `AI_BACKEND=copilot` or `AI_BACKEND=azure` in your `.env` file and restart the application.

## Usage

1. Run `python main.py` from the repository root
2. Join a Teams meeting and enable live captions to capture transcripts, or browse existing data in `transcripts.db`
3. Open `http://localhost:5000` in your browser
4. Select a meeting from the list to view its transcript
5. Use the search box to filter captions

## API Endpoints

- `GET /api/meetings` - Get all meetings
- `GET /api/meetings/<id>` - Get a specific meeting
- `GET /api/meetings/<id>/captions` - Get captions for a meeting (SSE streaming)
- `POST /api/meetings/<id>/chat` - Chat with AI about meeting (SSE streaming)
- `GET /api/meetings/<id>/chat/history` - Get chat history for a meeting
- `POST /api/meetings/<id>/chat/save` - Save a chat message
- `DELETE /api/meetings/<id>/chat/clear` - Clear chat history
- `GET /api/stats` - Get overall statistics

## Development

The frontend is built with:
- **React** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework

The backend is built with:
- **Flask** - Python web framework
- **Flask-CORS** - Cross-origin resource sharing
- **SQLite** - Database

## Future Enhancements

- Export transcripts to various formats (PDF, TXT, DOCX)
- Real-time updates when new captions are captured
- Speaker analytics and word clouds
- Meeting duration and activity graphs
- Full-text search with fuzzy matching
- Dark mode support
