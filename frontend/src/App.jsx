import { useState, useEffect } from 'react'
import MeetingList from './components/MeetingList'
import TranscriptViewer from './components/TranscriptViewer'
import LiveMode from './components/LiveMode'

function App() {
  const [selectedMeeting, setSelectedMeeting] = useState(null)
  const [viewMode, setViewMode] = useState('transcript') // 'transcript' or 'live'
  const [stats, setStats] = useState(null)

  useEffect(() => {
    // Fetch stats
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Error fetching stats:', err))
  }, [])

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg flex-shrink-0">
        <div className="xl:max-w-9/10 max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Teams Transcript Viewer</h1>
              <p className="text-sm text-blue-100 mt-1">View and search your meeting transcripts</p>
            </div>
            {stats && (
              <div className="flex gap-4 text-sm">
                <div className="text-center bg-white rounded-lg shadow-lg px-6 py-3 min-w-[100px]">
                  <div className="text-3xl font-bold text-blue-600">{stats.total_meetings}</div>
                  <div className="text-gray-600 font-medium mt-1">Meetings</div>
                </div>
                <div className="text-center bg-white rounded-lg shadow-lg px-6 py-3 min-w-[100px]">
                  <div className="text-3xl font-bold text-green-600">{stats.total_captions}</div>
                  <div className="text-gray-600 font-medium mt-1">Captions</div>
                </div>
                <div className="text-center bg-white rounded-lg shadow-lg px-6 py-3 min-w-[100px]">
                  <div className="text-3xl font-bold text-purple-600">{stats.unique_speakers}</div>
                  <div className="text-gray-600 font-medium mt-1">Speakers</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="xl:max-w-9/10 max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          {/* Meeting List */}
          <div className="lg:col-span-1 min-h-0">
            <MeetingList 
              selectedMeeting={selectedMeeting}
              onSelectMeeting={(id) => {
                setSelectedMeeting(id)
                setViewMode('transcript') // Reset to transcript view when selecting new meeting
              }}
            />
          </div>

          {/* Transcript Viewer or Live Mode */}
          <div className="lg:col-span-2 min-h-0">
            {selectedMeeting ? (
              viewMode === 'live' ? (
                <LiveMode meetingId={selectedMeeting} onBack={() => setViewMode('transcript')} />
              ) : (
                <TranscriptViewer meetingId={selectedMeeting} onShowLiveMode={() => setViewMode('live')} />
              )
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center h-full flex flex-col items-center justify-center">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <h3 className="mt-4 text-lg font-medium text-gray-900">No meeting selected</h3>
                <p className="mt-2 text-sm text-gray-500">Select a meeting from the list to view its transcript</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
