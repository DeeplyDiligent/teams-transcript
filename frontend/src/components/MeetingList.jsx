import { useState, useEffect } from 'react'

export default function MeetingList({ selectedMeeting, onSelectMeeting }) {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
        <h2 className="text-lg font-bold text-gray-900">Meetings</h2>
        <p className="text-sm text-gray-600 mt-1\">{meetings.length} total</p>
      </div>
      
      <div className="divide-y overflow-y-auto flex-1">
        {meetings.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No meetings found
          </div>
        ) : (
          meetings.map((meeting) => (
            <button
              key={meeting.meeting_id}
              onClick={() => onSelectMeeting(meeting.meeting_id)}
              className={`w-full text-left p-4 hover:bg-blue-50 transition-colors border-l-4 ${
                selectedMeeting === meeting.meeting_id 
                  ? 'bg-blue-50 border-blue-600 shadow-sm border-t border-r' 
                  : 'border-transparent hover:border-blue-300 hover:border-t hover:border-r'
              }`}
            >
              <div className="font-medium text-sm text-gray-900 truncate">
                {meeting.meeting_name || 'Untitled Meeting'}
              </div>
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
