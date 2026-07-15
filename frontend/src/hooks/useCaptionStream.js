import { useEffect, useRef, useState } from 'react'

export default function useCaptionStream({
  meetingId,
  limit,
  onInitial,
  onCaption,
  onUpdate,
  onServerError,
}) {
  const callbacksRef = useRef({})
  const [connectedMeetingId, setConnectedMeetingId] = useState(null)
  const [initializedMeetingId, setInitializedMeetingId] = useState(null)

  useEffect(() => {
    callbacksRef.current = {
      onInitial,
      onCaption,
      onUpdate,
      onServerError,
    }
  }, [onInitial, onCaption, onUpdate, onServerError])

  useEffect(() => {
    if (!meetingId) {
      return undefined
    }

    const query = limit ? `?limit=${encodeURIComponent(limit)}` : ''
    const eventSource = new EventSource(
      `/api/meetings/${meetingId}/captions${query}`,
    )

    eventSource.onopen = () => {
      setConnectedMeetingId(meetingId)
    }

    eventSource.onerror = () => {
      setConnectedMeetingId(null)
      // EventSource owns reconnection. Closing here would disable it.
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'initial') {
          callbacksRef.current.onInitial?.(data.captions)
          setInitializedMeetingId(meetingId)
        } else if (data.type === 'caption') {
          callbacksRef.current.onCaption?.(data.caption)
        } else if (data.type === 'update') {
          callbacksRef.current.onUpdate?.(data.caption)
        } else if (data.type === 'error') {
          callbacksRef.current.onServerError?.(data.message)
        }
      } catch (error) {
        callbacksRef.current.onServerError?.(
          `Invalid caption stream message: ${error.message}`,
        )
      }
    }

    return () => {
      eventSource.onopen = null
      eventSource.onerror = null
      eventSource.onmessage = null
      eventSource.close()
    }
  }, [meetingId, limit])

  return {
    connected: Boolean(meetingId) && connectedMeetingId === meetingId,
    loading: Boolean(meetingId) && initializedMeetingId !== meetingId,
  }
}
