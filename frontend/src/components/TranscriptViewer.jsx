import { useState, useEffect, useRef } from 'react'
import ChatResponse from './ChatResponse'
import useCaptionStream from '../hooks/useCaptionStream'

export default function TranscriptViewer({ meetingId, onShowLiveMode, onBackToList }) {
  const [meeting, setMeeting] = useState(null)
  const [captions, setCaptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState('')
  const chatEndRef = useRef(null)
  const chatContainerRef = useRef(null)
  const shouldAutoScrollRef = useRef(true)

  // Auto-scroll to bottom when messages change, but only if user is at bottom
  useEffect(() => {
    // Check if user is at/near the bottom before message update
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      // If within 100px of bottom, consider user is at bottom
      shouldAutoScrollRef.current = distanceFromBottom < 100
    }
  }, [chatMessages])

  useEffect(() => {
    // Only scroll if user was at bottom
    if (chatEndRef.current && shouldAutoScrollRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages])

  // Clear chat and load history when meeting changes
  useEffect(() => {
    if (meetingId) {
      setChatMessages([])
      loadChatHistory()
    }
  }, [meetingId])

  useEffect(() => {
    if (meetingId) {
      fetchMeetingData()
    }
  }, [meetingId])

  const { connected } = useCaptionStream({
    meetingId,
    onInitial: (initialCaptions) => {
      setCaptions(initialCaptions)
      setLoading(false)
      setError(null)
    },
    onCaption: (caption) => {
      setCaptions((previous) => [...previous, caption])
    },
    onUpdate: (caption) => {
      setCaptions((previous) => previous.map((item) => (
        item.caption_id === caption.caption_id ? caption : item
      )))
    },
    onServerError: setError,
  })

  const loadChatHistory = async () => {
    try {
      const response = await fetch(`/api/meetings/${meetingId}/chat/history`)
      if (response.ok) {
        const history = await response.json()
        setChatMessages(history.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          streaming: false
        })))
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
  }

  const saveChatMessage = async (role, content) => {
    try {
      await fetch(`/api/meetings/${meetingId}/chat/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role, content })
      })
    } catch (error) {
      console.error('Failed to save chat message:', error)
    }
  }

  const clearChatHistory = async () => {
    if (!confirm('Are you sure you want to clear all chat history for this meeting?')) {
      return
    }
    
    try {
      const response = await fetch(`/api/meetings/${meetingId}/chat/clear`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setChatMessages([])
      } else {
        alert('Failed to clear chat history')
      }
    } catch (error) {
      console.error('Failed to clear chat history:', error)
      alert('Failed to clear chat history')
    }
  }

  const updateMeetingName = async (newName) => {
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
      setMeeting({ ...meeting, meeting_name: newName })
      setIsEditingName(false)
      setEditingName('')
    } catch (err) {
      alert('Error updating meeting name: ' + err.message)
    }
  }

  const handleEditClick = () => {
    setIsEditingName(true)
    setEditingName(meeting?.meeting_name || 'Untitled Meeting')
  }

  const handleSaveEdit = () => {
    if (editingName.trim()) {
      updateMeetingName(editingName.trim())
    }
  }

  const handleCancelEdit = () => {
    setIsEditingName(false)
    setEditingName('')
  }

  const fetchMeetingData = async () => {
    try {
      setLoading(true)
      
      // Fetch meeting details
      const meetingRes = await fetch(`/api/meetings/${meetingId}`)
      if (!meetingRes.ok) throw new Error('Failed to fetch meeting')
      const meetingData = await meetingRes.json()
      
      setMeeting(meetingData)
      setError(null)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const formatTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    })
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (chatInput.trim()) {
      const userMessage = chatInput
      const timestamp = Date.now()
      const userMessageId = `user-${timestamp}`
      const aiMessageId = `ai-${timestamp}`
      
      // Add both user message and AI placeholder in one update
      setChatMessages(prev => [...prev, 
        {
          id: userMessageId,
          role: 'user',
          content: userMessage,
          timestamp: new Date().toISOString()
        },
        {
          id: aiMessageId,
          role: 'assistant',
          content: '',
          reasoning: '',
          timestamp: new Date().toISOString(),
          streaming: true,
          showReasoning: true
        }
      ])
      setChatInput('')
      
      // Save user message to database
      saveChatMessage('user', userMessage)
      
      // Send to AI agent API
      try {
        console.log('Sending chat message:', userMessage, 'to meeting', meetingId)
        const response = await fetch(`/api/meetings/${meetingId}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: userMessage })
        })
        
        console.log('Response status:', response.status, response.ok)
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error('Response error:', errorText)
          throw new Error('Failed to send message')
        }
        
        // Read SSE stream
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let aiResponse = ''
        let aiReasoning = ''
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                
                if (data.type === 'reasoning') {
                  // Append reasoning chunk
                  aiReasoning += data.content
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, reasoning: aiReasoning, streaming: true }
                      : msg
                  ))
                } else if (data.type === 'chunk') {
                  // Append chunk to response and update UI
                  // Auto-hide reasoning when message starts
                  aiResponse += data.content
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, content: aiResponse, streaming: true, showReasoning: false }
                      : msg
                  ))
                } else if (data.type === 'done') {
                  // Mark streaming as complete and save to database
                  if (aiResponse) {
                    saveChatMessage('assistant', aiResponse)
                  }
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, streaming: false }
                      : msg
                  ))
                } else if (data.type === 'error') {
                  aiResponse = `Error: ${data.message}`
                  saveChatMessage('assistant', aiResponse)
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, content: aiResponse, streaming: false }
                      : msg
                  ))
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e)
              }
            }
          }
        }
        
      } catch (error) {
        console.error('Chat error:', error)
        const errorMsg = 'Sorry, I encountered an error processing your request.'
        saveChatMessage('assistant', errorMsg)
        setChatMessages(prev => prev.map(msg => 
          msg.id === aiMessageId 
            ? { ...msg, content: errorMsg, streaming: false }
            : msg
        ))
      }
    }
  }

  const getParticipants = () => {
    const speakers = new Set()
    captions.forEach(cap => speakers.add(cap.speaker))
    return Array.from(speakers)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 h-full flex flex-col">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 h-full flex flex-col">
        <div className="text-red-600">
          <p>Error: {error}</p>
          <button 
            onClick={fetchMeetingData}
            className="mt-2 text-blue-600 hover:text-blue-800"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!meeting) return null

  // Transcript view modal
  if (showTranscript) {
    return <TranscriptView 
      meeting={meeting}
      captions={captions}
      connected={connected}
      onClose={() => setShowTranscript(false)}
    />
  }

  // Main chat interface
  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full flex flex-col">
      {/* Meeting Info Card */}
      <div className="p-3 sm:p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-gray-200 flex-shrink-0">
        {/* Mobile back button */}
        {onBackToList && (
          <div className="lg:hidden mb-3">
            <button
              onClick={onBackToList}
              className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">Back to Meetings</span>
            </button>
          </div>
        )}
        
        {isEditingName ? (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              style={{ textOverflow: 'clip' }}
              className="flex-1 min-w-0 px-2 sm:px-3 py-1.5 sm:py-2 text-lg sm:text-xl font-bold border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 overflow-x-auto"
              autoFocus
            />
            <button
              onClick={handleSaveEdit}
              className="p-1.5 sm:p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors flex-shrink-0"
              title="Save"
            >
              <svg className="w-5 sm:w-6 h-5 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-1.5 sm:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
              title="Cancel"
            >
              <svg className="w-5 sm:w-6 h-5 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg sm:text-2xl font-bold text-gray-900 truncate flex-1 min-w-0 pr-2">
              {meeting.meeting_name || 'Untitled Meeting'}
            </h2>
            <button
              onClick={handleEditClick}
              className="p-1.5 sm:p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
              title="Edit meeting name"
            >
              <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}
        
        <div className="hidden lg:grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{formatDate(meeting.start_time)} • {formatTime(meeting.start_time)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v4H7V5zm6 6H7v2h6v-2z" clipRule="evenodd" />
            </svg>
            <span className="truncate">Meeting ID: {meetingId}</span>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            <span>{getParticipants().length} participants</span>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
              <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
            </svg>
            <span>{captions.length} captions</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={() => setShowTranscript(true)}
            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">View Full Transcript</span>
            <span className="sm:hidden">Transcript</span>
          </button>
          <button
            onClick={onShowLiveMode}
            className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            Live Mode
          </button>
        </div>
      </div>

      {/* Chat Interface */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-6 bg-gray-50 min-h-0">
        {chatMessages.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <div className="inline-block p-3 sm:p-4 bg-white rounded-full shadow-md mb-3 sm:mb-4">
              <svg className="w-10 sm:w-12 h-10 sm:h-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Chat about this meeting</h3>
            <p className="text-xs sm:text-sm text-gray-600 mb-4 px-4">Ask questions about the transcript or request insights</p>
            <div className="max-w-md mx-auto text-left bg-white rounded-lg shadow-sm p-3 sm:p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Try asking:</p>
              <div className="space-y-2">
                <button
                  onClick={() => setChatInput("What were the main topics discussed?")}
                  className="block w-full text-left px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-700 hover:bg-blue-50 rounded-md transition-colors"
                >
                  💭 What were the main topics discussed?
                </button>
                <button
                  onClick={() => setChatInput("Summarize the key decisions")}
                  className="block w-full text-left px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-700 hover:bg-blue-50 rounded-md transition-colors"
                >
                  📋 Summarize the key decisions
                </button>
                <button
                  onClick={() => setChatInput("What action items were mentioned?")}
                  className="block w-full text-left px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-700 hover:bg-blue-50 rounded-md transition-colors"
                >
                  ✅ What action items were mentioned?
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4 max-w-3xl mx-auto">
            {chatMessages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[80%] rounded-lg px-3 sm:px-4 py-2 sm:py-3 ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                      : 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  }`}
                >
                  {message.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <>
                      {/* Reasoning section - collapsible */}
                      {message.reasoning && (
                        <details open={message.showReasoning} className="mb-3 bg-gray-50 rounded-md border border-gray-200">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Reasoning
                          </summary>
                          <div className="px-3 py-2 text-xs text-gray-700 font-mono whitespace-pre-wrap border-t border-gray-200">
                            {message.reasoning}{message.streaming && !message.content ? ' ●' : ''}
                          </div>
                        </details>
                      )}
                      
                      {!message.content && message.streaming && !message.reasoning ? (
                        <div className="flex items-center gap-2 text-gray-500">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                          </div>
                          <span className="text-sm">Thinking...</span>
                        </div>
                      ) : message.content ? (
                        <ChatResponse content={message.content + (message.streaming ? ' ●' : '')} />
                      ) : null}
                    </>
                  )}
                  <p className={`text-xs mt-1 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                    {formatTime(message.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div className="p-2 sm:p-4 bg-white border-t border-gray-200 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="flex gap-2 sm:gap-3">
          <button
            type="button"
            onClick={clearChatHistory}
            disabled={chatMessages.length === 0}
            className="px-2 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg hover:bg-gray-50 hover:border-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-red-600 flex-shrink-0"
            title="Clear chat history"
          >
            <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask about this meeting..."
            className="flex-1 px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm sm:text-base"
          />
          <button
            type="submit"
            disabled={!chatInput.trim()}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 sm:gap-2 flex-shrink-0"
          >
            <span className="hidden sm:inline">Send</span>
            <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}

// Transcript View Component
function TranscriptView({ meeting, captions, connected, onClose }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [, setUpdateTrigger] = useState(0)
  const [copySuccess, setCopySuccess] = useState(false)

  // Update every 5 seconds to refresh live status
  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTrigger(prev => prev + 1)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const filteredCaptions = captions.filter(caption =>
    caption.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
    caption.speaker.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Get unique participants
  const getParticipants = () => {
    const speakersSet = new Set()
    captions.forEach(caption => speakersSet.add(caption.speaker))
    return Array.from(speakersSet).sort()
  }

  // Check if meeting is actually live (last caption within 1 minute)
  const isLive = () => {
    if (!connected || captions.length === 0) return false
    const lastCaption = captions[captions.length - 1]
    const lastCaptionTime = new Date(lastCaption.timestamp).getTime()
    const now = Date.now()
    const oneMinute = 60 * 1000
    return (now - lastCaptionTime) < oneMinute
  }

  // Copy transcript to clipboard
  const handleCopyTranscript = async () => {
    // Group captions in chronological order (oldest first) for copy
    const chronologicalGroups = filteredCaptions.reduce((acc, caption) => {
      const lastGroup = acc[acc.length - 1]
      
      if (lastGroup && lastGroup.speaker === caption.speaker) {
        lastGroup.texts.push(caption.text)
      } else {
        acc.push({
          speaker: caption.speaker,
          texts: [caption.text]
        })
      }
      
      return acc
    }, [])

    // Format the transcript
    const formattedTranscript = chronologicalGroups.map(group => {
      const texts = group.texts.join('\n')
      return `${group.speaker}: ${texts}`
    }).join('\n\n')

    try {
      await navigator.clipboard.writeText(formattedTranscript)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy transcript:', err)
      alert('Failed to copy to clipboard')
    }
  }

  // Group consecutive captions from the same speaker (in reverse order - newest first)
  const groupedCaptions = filteredCaptions.slice().reverse().reduce((acc, caption) => {
    const lastGroup = acc[acc.length - 1]
    
    if (lastGroup && lastGroup.speaker === caption.speaker) {
      lastGroup.texts.push(caption.text)
      lastGroup.caption_ids.push(caption.caption_id)
    } else {
      acc.push({
        speaker: caption.speaker,
        timestamp: caption.timestamp,
        texts: [caption.text],
        caption_ids: [caption.caption_id]
      })
    }
    
    return acc
  }, [])

  const getSpeakerColor = (speaker) => {
    const colors = [
      { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
      { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
      { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
      { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
      { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200' },
      { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200' },
      { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200' },
      { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200' },
    ]
    const hash = speaker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors cursor-pointer pr-2 sm:pr-4 flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-base sm:text-xl font-bold text-gray-900 truncate flex-1 min-w-0 text-center px-2">
          {meeting.meeting_name || 'Untitled Meeting'}
        </h2>
        {isLive() && (
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-xs text-gray-600 font-medium">Live</span>
          </div>
        )}
        {!isLive() && <div className="w-10 sm:w-16"></div>}
      </div>

      {/* Search */}
      <div className="p-2 sm:p-4 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex gap-2 sm:gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search transcript..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 sm:px-4 py-2 sm:py-3 pl-9 sm:pl-11 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm sm:text-base"
            />
            <svg 
              className="absolute left-2.5 sm:left-3.5 top-2.5 sm:top-3.5 h-4 sm:h-5 w-4 sm:w-5 text-gray-400" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            onClick={handleCopyTranscript}
            disabled={filteredCaptions.length === 0}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-medium transition-all flex-shrink-0 text-sm sm:text-base ${
              copySuccess 
                ? 'bg-green-600 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            title="Copy transcript to clipboard"
          >
            {copySuccess ? (
              <>
                <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="hidden sm:inline">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Participants */}
      <div className="px-2 sm:px-4 py-2 sm:py-3 bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-gray-700 font-medium text-xs sm:text-sm flex-shrink-0">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            <span className="font-semibold">Participants ({getParticipants().length}):</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {getParticipants().map(speaker => (
              <span 
                key={speaker} 
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold border ${getSpeakerColor(speaker).bg} ${getSpeakerColor(speaker).text} ${getSpeakerColor(speaker).border}`}
              >
                {speaker}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div className="p-3 sm:p-6 overflow-y-auto flex-1 bg-gray-50">
        {groupedCaptions.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm sm:text-base">
            {searchTerm ? 'No matching captions found' : 'No captions available'}
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4 max-w-4xl mx-auto">
            {groupedCaptions.map((group, index) => (
              <div key={group.caption_ids.join('-')} className="bg-white hover:bg-gray-50 p-3 sm:p-4 rounded-lg transition-colors shadow-sm border border-gray-200">
                <div className="pl-1 sm:pl-2 space-y-1.5 sm:space-y-2 mb-2 sm:mb-3">
                  {group.texts.map((text, textIndex) => (
                    <p key={textIndex} className="text-gray-900 leading-relaxed text-sm sm:text-base">
                      {searchTerm ? (
                        <HighlightedText text={text} highlight={searchTerm} />
                      ) : (
                        text
                      )}
                    </p>
                  ))}
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <span className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold border ${getSpeakerColor(group.speaker).bg} ${getSpeakerColor(group.speaker).text} ${getSpeakerColor(group.speaker).border}`}>
                    {group.speaker}
                  </span>
                  <span className="text-xs sm:text-sm text-gray-600 font-mono font-medium">
                    {formatTime(group.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 bg-white border-t border-gray-200 text-xs text-gray-600 font-medium flex-shrink-0">
        Showing {filteredCaptions.length} of {captions.length} captions
      </div>
    </div>
  )
}

function HighlightedText({ text, highlight }) {
  if (!highlight.trim()) {
    return <span>{text}</span>
  }
  
  const regex = new RegExp(`(${highlight})`, 'gi')
  const parts = text.split(regex)
  
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-300 text-gray-900 rounded px-1 font-medium">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}
