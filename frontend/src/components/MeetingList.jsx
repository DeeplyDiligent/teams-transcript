import { useState, useEffect } from 'react'

export default function MeetingList({ selectedMeeting, onSelectMeeting }) {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingMeetingId, setEditingMeetingId] = useState(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    fetchMeetings()
  }, [])

  const fetchMeetings = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/meetings')
      if (!response.ok) throw new Error('Failed to fetch meetings')
      const data = await response.json()
      setMeetings(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const updateMeetingName = async (meetingId, newName) => {
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meeting_name: newName }),
      })
      
      if (!response.ok) throw new Error('Failed to update meeting name')
      
      // Update local state
      setMeetings(meetings.map(m => 
        m.meeting_id === meetingId ? { ...m, meeting_name: newName } : m
      ))
      setEditingMeetingId(null)
      setEditingName('')
    } catch (err) {
      alert('Error updating meeting name: ' + err.message)
    }
  }

  const handleEditClick = (meeting, e) => {
    e.stopPropagation()
    setEditingMeetingId(meeting.meeting_id)
    setEditingName(meeting.meeting_name || 'Untitled Meeting')
  }

  const handleSaveEdit = (meetingId, e) => {
    e.stopPropagation()
    if (editingName.trim()) {
      updateMeetingName(meetingId, editingName.trim())
    }
  }

  const handleCancelEdit = (e) => {
    e.stopPropagation()
    setEditingMeetingId(null)
    setEditingName('')
  }

  // Filter meetings based on search query
  const filteredMeetings = meetings.filter(meeting => {
    if (!searchQuery.trim()) return true
    const searchLower = searchQuery.toLowerCase()
    return (meeting.meeting_name || 'Untitled Meeting').toLowerCase().includes(searchLower)
  })

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Meetings</h2>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Meetings</h2>
        <div className="text-red-600 text-sm">
          <p>Error: {error}</p>
          <button 
            onClick={fetchMeetings}
            className="mt-2 text-blue-600 hover:text-blue-800"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full flex flex-col">
      <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Meetings</h2>
            <p className="text-sm text-gray-600 mt-1">{filteredMeetings.length} of {meetings.length}</p>
          </div>
          <button
            onClick={fetchMeetings}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            title="Refresh meetings"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        
        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>
      
      <div className="divide-y overflow-y-auto flex-1">
        {filteredMeetings.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            {searchQuery ? 'No meetings found matching your search' : 'No meetings found'}
          </div>
        ) : (
          filteredMeetings.map((meeting) => (
            <button
              key={meeting.meeting_id}
              onClick={() => onSelectMeeting(meeting.meeting_id)}
              className={`w-full text-left p-4 hover:bg-blue-50 transition-colors border-l-4 ${
                selectedMeeting === meeting.meeting_id 
                  ? 'bg-blue-50 border-blue-600 shadow-sm border-t border-r' 
                  : 'border-transparent hover:border-blue-300 hover:border-t hover:border-r'
              }`}
            >
              {editingMeetingId === meeting.meeting_id ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(meeting.meeting_id, e)
                      if (e.key === 'Escape') handleCancelEdit(e)
                    }}
                    style={{ textOverflow: 'clip' }}
                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 overflow-x-auto"
                    autoFocus
                  />
                  <button
                    onClick={(e) => handleSaveEdit(meeting.meeting_id, e)}
                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                    title="Save"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    title="Cancel"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex-1 font-medium text-sm text-gray-900 truncate">
                    {meeting.meeting_name || 'Untitled Meeting'}
                  </div>
                  <button
                    onClick={(e) => handleEditClick(meeting, e)}
                    className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Edit meeting name"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                {formatDate(meeting.start_time)}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                  </svg>
                  {meeting.caption_count} captions
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
