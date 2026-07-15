import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import useCaptionStream from '../hooks/useCaptionStream'

export default function LiveMode({ meetingId, onBack, onBackToList }) {
  const [captions, setCaptions] = useState([])
  const [aiResponse, setAiResponse] = useState('')
  const [previousResponse, setPreviousResponse] = useState('') // Keep old response while generating
  const [isGenerating, setIsGenerating] = useState(false)
  const [autoSend, setAutoSend] = useState(false)
  const [lastSentTime, setLastSentTime] = useState(null)
  const [isTranscriptMinimized, setIsTranscriptMinimized] = useState(false)
  const [nextSendCountdown, setNextSendCountdown] = useState(null)
  
  // Fixed query for the assistant
  const query = "What should I say next?"
  
  const silenceTimerRef = useRef(null)
  const maxWaitTimerRef = useRef(null)
  const chatEventSourceRef = useRef(null)
  const lastCaptionContentRef = useRef(null) // Track last caption content for new activity detection
  const lastSentCaptionContentRef = useRef(null) // Track caption content when we last sent
  const lastCaptionEventTimeRef = useRef(null) // Track when last caption event occurred
  const countdownIntervalRef = useRef(null)
  const autoSendStartTimeRef = useRef(null)
  const isGeneratingRef = useRef(false)
  const resetAutoSendTimersRef = useRef(null)

  const { connected, loading } = useCaptionStream({
    meetingId,
    limit: 200,
    onInitial: (initialCaptions) => {
      setCaptions(initialCaptions)
      if (initialCaptions.length > 0) {
        lastCaptionContentRef.current = initialCaptions
          .map((caption) => `${caption.caption_id}:${caption.text}`)
          .join('|')
      }
    },
    onCaption: (caption) => {
      setCaptions((previous) => {
        const updated = [...previous, caption]
        lastCaptionContentRef.current = updated
          .map((item) => `${item.caption_id}:${item.text}`)
          .join('|')
        lastCaptionEventTimeRef.current = Date.now()
        window.resetAutoSendTimers?.()
        return updated
      })
    },
    onUpdate: (caption) => {
      setCaptions((previous) => {
        const oldCaption = previous.find(
          (item) => item.caption_id === caption.caption_id,
        )
        const updated = previous.map((item) => (
          item.caption_id === caption.caption_id ? caption : item
        ))
        if (oldCaption && oldCaption.text !== caption.text) {
          lastCaptionContentRef.current = updated
            .map((item) => `${item.caption_id}:${item.text}`)
            .join('|')
          lastCaptionEventTimeRef.current = Date.now()
          window.resetAutoSendTimers?.()
        }
        return updated
      })
    },
    onServerError: (message) => {
      console.error('Caption stream error:', message)
    },
  })

  useEffect(() => {
    return () => {
      if (chatEventSourceRef.current) {
        chatEventSourceRef.current.close()
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current)
      }
      window.resetAutoSendTimers = null
    }
  }, [])

  const handleGenerate = useCallback(async (useLimit = false) => {
    if (!query.trim() || isGeneratingRef.current) return
    
    isGeneratingRef.current = true
    setIsGenerating(true)
    // Store current response as previous before generating new one
    setAiResponse(prev => {
      if (prev) setPreviousResponse(prev)
      return prev
    })
    setLastSentTime(new Date().toLocaleTimeString())
    
    // Track what caption content we're sending with
    lastSentCaptionContentRef.current = lastCaptionContentRef.current
    
    // Reset auto-send timers if auto-send is enabled
    if (resetAutoSendTimersRef.current) {
      resetAutoSendTimersRef.current()
    }
    
    // Close existing chat connection
    if (chatEventSourceRef.current) {
      chatEventSourceRef.current.close()
    }
    
    try {
      // Use caption limit only for auto-send, full transcript for manual
      const url = useLimit 
        ? `/api/meetings/${meetingId}/chat?no_save=true&limit=200`
        : `/api/meetings/${meetingId}/chat?no_save=true`
      console.log('LiveMode: Sending request to:', url, 'with message:', query)
      
      // Use fetch for POST with SSE response
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: query })
      })
      
      console.log('LiveMode: Response status:', response.status, response.ok)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('LiveMode: Response error:', errorText)
        
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.error) {
            setAiResponse(`⚠️ ${errorJson.error}\n\nPlease make sure:\n- The meeting has captions\n- You're viewing an active or recent meeting`)
            setIsGenerating(false)
            isGeneratingRef.current = false
            return
          }
        } catch (e) {
          // Not JSON, continue with generic error
        }
        
        throw new Error('Failed to generate response')
      }
      
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullResponse = ''
      
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            
            try {
              const data = JSON.parse(dataStr)
              
              if (data.type === 'chunk') {
                fullResponse += data.content
              } else if (data.type === 'done') {
                // Response complete - show it now
                setAiResponse(fullResponse)
                setPreviousResponse('') // Clear previous response
                setIsGenerating(false)
                isGeneratingRef.current = false
              } else if (data.type === 'error') {
                console.error('AI error:', data.message)
                setAiResponse(`Error: ${data.message}`)
                setIsGenerating(false)
                isGeneratingRef.current = false
              }
            } catch (err) {
              console.error('Error parsing SSE data:', err)
            }
          }
        }
      }
    } catch (err) {
      console.error('Error generating response:', err)
      setAiResponse(`Error: ${err.message}`)
      isGeneratingRef.current = false
    } finally {
      setIsGenerating(false)
      isGeneratingRef.current = false
    }
  }, [meetingId, query])

  // Auto-send functionality
  useEffect(() => {
    if (autoSend && query) {
      console.log('Auto-send enabled')
      
      // Function to trigger auto-send
      const triggerAutoSend = () => {
        // Only send if there's new caption content since last send
        if (lastCaptionContentRef.current && 
            lastCaptionContentRef.current !== lastSentCaptionContentRef.current) {
          console.log('Auto-send: Triggering send')
          handleGenerate(true)
        } else {
          console.log('Auto-send: No new content to send')
        }
        // After sending, reset both timers for next cycle
        resetAutoSendTimers()
      }
      
      // Reset only the silence timer (called on new captions)
      const resetSilenceTimer = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        
        // Start silence timer (2 seconds of no activity)
        silenceTimerRef.current = setTimeout(() => {
          console.log('Auto-send: 2 seconds of silence detected')
          triggerAutoSend()
        }, 2000)
      }
      
      // Reset and start both timers (called on enable or after send)
      const resetAutoSendTimers = () => {
        // Clear existing timers
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
        
        // Record start time for countdown
        autoSendStartTimeRef.current = Date.now()
        
        // Start silence timer (2 seconds of no activity)
        silenceTimerRef.current = setTimeout(() => {
          console.log('Auto-send: 2 seconds of silence detected')
          triggerAutoSend()
        }, 2000)
        
        // Start max wait timer (15 seconds total)
        maxWaitTimerRef.current = setTimeout(() => {
          console.log('Auto-send: 15 second max wait reached')
          triggerAutoSend()
        }, 15000)
      }
      
      // Start the timers when auto-send is enabled
      resetAutoSendTimers()
      
      // Store the reset functions for external use
      window.resetAutoSendTimers = resetSilenceTimer
      resetAutoSendTimersRef.current = resetAutoSendTimers
      
      // Start countdown display
      countdownIntervalRef.current = setInterval(() => {
        if (autoSendStartTimeRef.current) {
          // Only show countdown if there's new content since last send
          const hasNewContent = lastCaptionContentRef.current && 
            lastCaptionContentRef.current !== lastSentCaptionContentRef.current
          
          if (hasNewContent) {
            const elapsed = Date.now() - autoSendStartTimeRef.current
            const remaining = Math.max(0, Math.ceil((15000 - elapsed) / 1000))
            setNextSendCountdown(remaining)
          } else {
            setNextSendCountdown(null)
          }
        }
      }, 100) // Update every 100ms for smooth countdown
    } else {
      // Clear all timers when disabled
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current)
        maxWaitTimerRef.current = null
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
      window.resetAutoSendTimers = null
      resetAutoSendTimersRef.current = null
      setNextSendCountdown(null)
      autoSendStartTimeRef.current = null
      console.log('Auto-send disabled')
    }
    
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      window.resetAutoSendTimers = null
    }
  }, [autoSend, query, handleGenerate])

  const getSpeakerColor = (speaker) => {
    const colors = [
      'text-blue-700 bg-blue-50',
      'text-green-700 bg-green-50',
      'text-purple-700 bg-purple-50',
      'text-orange-700 bg-orange-50',
      'text-pink-700 bg-pink-50',
      'text-indigo-700 bg-indigo-50',
      'text-teal-700 bg-teal-50',
      'text-red-700 bg-red-50',
    ]
    const hash = speaker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white rounded-lg shadow-sm">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Connecting to live meeting...</p>
        </div>
      </div>
    )
  }

  // Group consecutive captions from the same speaker
  const groupedCaptions = captions.reduce((acc, caption) => {
    const lastGroup = acc[acc.length - 1]
    
    if (lastGroup && lastGroup.speaker === caption.speaker) {
      lastGroup.texts.push(caption.text)
      lastGroup.caption_ids.push(caption.caption_id)
      lastGroup.lastTimestamp = caption.timestamp
    } else {
      acc.push({
        speaker: caption.speaker,
        timestamp: caption.timestamp,
        lastTimestamp: caption.timestamp,
        texts: [caption.text],
        caption_ids: [caption.caption_id]
      })
    }
    
    return acc
  }, [])

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-md overflow-hidden">
      {/* Header */}
      <div className="p-2 sm:p-4 bg-gradient-to-r from-green-50 to-emerald-50 flex-shrink-0">
        {/* Mobile back to meetings button */}
        {onBackToList && (
          <div className="lg:hidden mb-2">
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
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Desktop back to transcript button */}
            <button
              onClick={onBack}
              className="hidden lg:flex items-center gap-1 sm:gap-2 text-gray-700 hover:text-gray-900 transition-colors cursor-pointer flex-shrink-0"
              title="Back to transcript"
            >
              <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className={`w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full flex-shrink-0 ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-gray-900">Live Mode</h2>
              <p className="text-xs sm:text-sm text-gray-600">{connected ? 'Connected' : 'Disconnected'}</p>
            </div>
          </div>
          
          {/* Auto-send toggle */}
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
                className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-xs sm:text-sm font-medium text-gray-700">
                Auto Send
              </span>
            </label>
            {autoSend && (
              <div className="flex items-center gap-2">
                {nextSendCountdown !== null ? (
                  <span className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    {nextSendCountdown}s
                  </span>
                ) : null}
                {lastSentTime && (
                  <span className="text-xs text-gray-500 hidden sm:inline">Last: {lastSentTime}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Split view container */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Transcript Panel - 50% or minimized on desktop, full-width collapsible on mobile */}
        <div className={`flex flex-col transition-all duration-300 ${
          isTranscriptMinimized 
            ? 'md:w-12 h-12 md:h-auto' 
            : 'md:w-1/2 h-1/2 md:h-auto'
        }`}>
          <div className="p-2 sm:p-3 bg-gray-50 flex-shrink-0 flex items-center justify-between border-b md:border-r border-gray-200">
            <div className={isTranscriptMinimized ? 'hidden' : 'flex-1 min-w-0'}>
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Live Transcript</h3>
              <p className="text-xs text-gray-500 mt-0.5 sm:mt-1">{captions.length} captions</p>
            </div>
            <button
              onClick={() => setIsTranscriptMinimized(!isTranscriptMinimized)}
              className="p-1 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
              title={isTranscriptMinimized ? 'Expand transcript' : 'Minimize transcript'}
            >
              <svg className="w-4 sm:w-5 h-4 sm:h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isTranscriptMinimized ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" className="md:hidden" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" className="md:hidden" />
                )}
                {isTranscriptMinimized ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" className="hidden md:block" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" className="hidden md:block" />
                )}
              </svg>
            </button>
          </div>
          
          <div className={`flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-3 ${isTranscriptMinimized ? 'hidden' : ''}`}>
            {captions.length === 0 ? (
              <div className="text-center text-gray-500 py-4 sm:py-8">
                <p className="text-sm">No captions yet. Waiting for the meeting to start...</p>
              </div>
            ) : (
              [...groupedCaptions].reverse().map((group) => (
                <div key={group.caption_ids.join('-')} className="flex gap-2 sm:gap-3">
                  <div className="flex-shrink-0 text-xs text-gray-400 w-12 sm:w-16 pt-1">
                    {formatTime(group.timestamp)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`inline-block px-1.5 sm:px-2 py-0.5 rounded text-xs font-medium mb-1 ${getSpeakerColor(group.speaker)}`}>
                      {group.speaker}
                    </div>
                    <div className="space-y-1">
                      {[...group.texts].reverse().map((text, idx) => (
                        <p key={idx} className="text-gray-800 text-sm">{text}</p>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI Response Panel - 50% or expanded on desktop, bottom half on mobile */}
        <div className={`flex flex-col bg-gray-50 transition-all duration-300 ${
          isTranscriptMinimized 
            ? 'flex-1' 
            : 'md:w-1/2 h-1/2 md:h-auto'
        }`}>
          <div className="p-2 sm:p-3 flex-shrink-0 flex items-center justify-between border-b border-gray-200">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">AI Assistant</h3>
              <p className="text-xs text-gray-500 mt-0.5 sm:mt-1 truncate">Ask questions about the conversation</p>
            </div>
            <button
              onClick={() => handleGenerate(false)}
              disabled={isGenerating}
              className="p-1.5 sm:p-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex-shrink-0 ml-2"
              title="What should I say next?"
            >
              {isGenerating ? (
                <svg className="animate-spin h-4 sm:h-5 w-4 sm:w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span className="text-lg sm:text-xl">🪄</span>
              )}
            </button>
          </div>
          
          {/* AI Response */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-4 bg-white">
            {(isGenerating && previousResponse) ? (
              <article className="prose prose-sm max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-code:text-pink-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs sm:prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:text-xs sm:prose-pre:text-sm prose-pre:overflow-x-auto">
                <ReactMarkdown>{previousResponse}</ReactMarkdown>
              </article>
            ) : aiResponse ? (
              <article className="prose prose-sm max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-code:text-pink-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs sm:prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:text-xs sm:prose-pre:text-sm prose-pre:overflow-x-auto">
                <ReactMarkdown>{aiResponse}</ReactMarkdown>
              </article>
            ) : (
              <div className="text-center text-gray-500 py-4 sm:py-8">
                <svg className="mx-auto h-10 sm:h-12 w-10 sm:w-12 text-gray-400 mb-2 sm:mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-5 5v-5z" />
                </svg>
                <p className="text-sm">Click the magic wand to get AI insights</p>
                <p className="text-xs mt-2">Auto-send analyzes recent conversation context</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
