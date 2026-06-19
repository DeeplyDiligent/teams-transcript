import { useState, useEffect } from 'react'
import MeetingList from './components/MeetingList'
import TranscriptViewer from './components/TranscriptViewer'
import LiveMode from './components/LiveMode'
import TasksView from './components/TasksView'

function App() {
  const [selectedMeeting, setSelectedMeeting] = useState(null)
  const [viewMode, setViewMode] = useState('transcript') // 'transcript' or 'live'
  const [activeTab, setActiveTab] = useState('transcripts') // 'transcripts' or 'tasks'

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header - Hidden on mobile */}
      <header className="hidden lg:block bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg flex-shrink-0">
        <div className="xl:max-w-9/10 max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="w-14 h-14 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-inner">
                <svg className="w-9 h-9" viewBox="0 0 48 48" fill="none">
                  {/* Video camera / meeting symbol */}
                  <rect x="4" y="12" width="28" height="20" rx="3" fill="white" opacity="0.9"/>
                  <polygon points="36,17 44,13 44,33 36,29" fill="white" opacity="0.7"/>
                  {/* Transcript cursor / lines overlay */}
                  <rect x="8" y="35" width="20" height="2" rx="1" fill="white" opacity="0.5"/>
                  <rect x="8" y="40" width="13" height="2" rx="1" fill="white" opacity="0.35"/>
                  <rect x="8" y="45" width="16" height="2" rx="1" fill="white" opacity="0.2"/>
                  {/* Closed caption "CC" badge */}
                  <rect x="24" y="24" width="14" height="10" rx="2" fill="#6366f1"/>
                  <text x="31" y="32" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="Arial, sans-serif">CC</text>
                </svg>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Teams Transcript Viewer</h1>
                <p className="text-xs sm:text-sm text-blue-100 mt-1">View and search your meeting transcripts</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Tab Buttons */}
              <div className="flex bg-white/20 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('transcripts')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'transcripts'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  Transcripts
                </button>
                <button
                  onClick={() => setActiveTab('tasks')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'tasks'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  Tasks
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Tab Bar */}
      <div className="lg:hidden flex bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={() => setActiveTab('transcripts')}
          className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
            activeTab === 'transcripts'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Transcripts
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
            activeTab === 'tasks'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Tasks
        </button>
      </div>

      {/* Main Content */}
      {activeTab === 'tasks' ? (
        <div className="xl:max-w-9/10 max-w-full mx-auto px-0 lg:px-8 py-0 lg:py-8 flex-1 min-h-0 w-full">
          <TasksView onViewTranscript={(meetingId) => {
            setSelectedMeeting(meetingId)
            setViewMode('transcript')
            setActiveTab('transcripts')
          }} />
        </div>
      ) : (
        <div className="xl:max-w-9/10 max-w-full mx-auto px-0 lg:px-8 py-0 lg:py-8 flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-6 h-full">
            {/* Meeting List - Hidden on mobile when meeting selected */}
            <div className={`lg:col-span-1 min-h-0 ${selectedMeeting ? 'hidden lg:block' : 'block'}`}>
              <MeetingList 
                selectedMeeting={selectedMeeting}
                onSelectMeeting={(id) => {
                  setSelectedMeeting(id)
                  setViewMode('transcript') // Reset to transcript view when selecting new meeting
                }}
              />
            </div>

            {/* Transcript Viewer or Live Mode - Hidden on mobile when no meeting selected */}
            <div className={`lg:col-span-2 min-h-0 ${selectedMeeting ? 'block' : 'hidden lg:block'}`}>
              {selectedMeeting ? (
                viewMode === 'live' ? (
                  <LiveMode 
                    meetingId={selectedMeeting} 
                    onBack={() => setViewMode('transcript')}
                    onBackToList={() => setSelectedMeeting(null)}
                  />
                ) : (
                  <TranscriptViewer 
                    meetingId={selectedMeeting} 
                    onShowLiveMode={() => setViewMode('live')}
                    onBackToList={() => setSelectedMeeting(null)}
                  />
                )
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-6 sm:p-12 text-center h-full flex flex-col items-center justify-center">
                  <svg className="mx-auto h-10 sm:h-12 w-10 sm:w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <h3 className="mt-4 text-base sm:text-lg font-medium text-gray-900">No meeting selected</h3>
                  <p className="mt-2 text-xs sm:text-sm text-gray-500">Select a meeting from the list to view its transcript</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
