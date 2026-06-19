import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

export default function TasksView({ onViewTranscript }) {
  const [meetingsWithActions, setMeetingsWithActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [visibleCount, setVisibleCount] = useState(20)
  const [filter, setFilter] = useState('open') // 'all' | 'open' | 'completed'
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [generatingMeetings, setGeneratingMeetings] = useState(new Set())
  const [activeMenuId, setActiveMenuId] = useState(null)
  const pollingRef = useRef(null)

  const fetchActions = useCallback(async () => {
    try {
      const response = await fetch('/api/actions')
      if (response.ok) {
        const data = await response.json()
        setMeetingsWithActions(data)
        
        // Track which meetings are currently generating
        const generating = new Set()
        data.forEach(m => {
          if (m.actions_status === 'generating') generating.add(m.meeting_id)
        })
        setGeneratingMeetings(generating)
      }
    } catch (error) {
      console.error('Failed to fetch actions:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActions()
    
    // Poll every 30 seconds to pick up server-side generation updates
    pollingRef.current = setInterval(fetchActions, 30000)
    
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [fetchActions])

  const handleToggle = async (actionId) => {
    try {
      const response = await fetch(`/api/actions/${actionId}/toggle`, {
        method: 'PUT'
      })
      if (response.ok) {
        const result = await response.json()
        // Recursively collect all descendant IDs
        const getDescendants = (id, actions) => {
          const children = actions.filter(a => a.parent_id === id)
          let ids = children.map(c => c.action_id)
          children.forEach(c => { ids = ids.concat(getDescendants(c.action_id, actions)) })
          return ids
        }
        setMeetingsWithActions(prev => prev.map(meeting => {
          const descIds = new Set(getDescendants(actionId, meeting.actions))
          return {
            ...meeting,
            actions: meeting.actions.map(action => {
              if (action.action_id === actionId || descIds.has(action.action_id)) {
                return { ...action, checked: result.checked }
              }
              return action
            })
          }
        }))
      }
    } catch (error) {
      console.error('Failed to toggle action:', error)
    }
  }

  const handleToggleMeeting = async (meetingId, checked) => {
    const meeting = meetingsWithActions.find(m => m.meeting_id === meetingId)
    if (!meeting) return
    const actionIds = meeting.actions.map(a => a.action_id)
    if (actionIds.length === 0) return
    
    try {
      const response = await fetch('/api/actions/batch-toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_ids: actionIds, checked: checked ? 1 : 0 })
      })
      if (response.ok) {
        setMeetingsWithActions(prev => prev.map(m =>
          m.meeting_id === meetingId
            ? { ...m, actions: m.actions.map(a => ({ ...a, checked: checked ? 1 : 0 })) }
            : m
        ))
      }
    } catch (error) {
      console.error('Failed to batch toggle:', error)
    }
  }

  const handleCheckAllVisible = async (checked) => {
    const allActionIds = []
    filteredMeetings.forEach(m => {
      m.actions.forEach(a => allActionIds.push(a.action_id))
    })
    if (allActionIds.length === 0) return

    const action = checked ? 'check' : 'uncheck'
    if (!window.confirm(`Are you sure you want to ${action} all ${allActionIds.length} action items in view?`)) return
    
    try {
      const response = await fetch('/api/actions/batch-toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_ids: allActionIds, checked: checked ? 1 : 0 })
      })
      if (response.ok) {
        const filteredIds = new Set(filteredMeetings.map(m => m.meeting_id))
        setMeetingsWithActions(prev => prev.map(m =>
          filteredIds.has(m.meeting_id)
            ? { ...m, actions: m.actions.map(a => ({ ...a, checked: checked ? 1 : 0 })) }
            : m
        ))
      }
    } catch (error) {
      console.error('Failed to batch toggle all:', error)
    }
  }

  const handleEditAction = async (actionId, newTitle) => {
    try {
      const response = await fetch(`/api/actions/${actionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      })
      if (response.ok) {
        setMeetingsWithActions(prev => prev.map(m => ({
          ...m,
          actions: m.actions.map(a => a.action_id === actionId ? { ...a, title: newTitle } : a)
        })))
      }
    } catch (error) {
      console.error('Failed to edit action:', error)
    }
  }

  const handleDeleteAction = async (actionId) => {
    try {
      const response = await fetch(`/api/actions/${actionId}`, { method: 'DELETE' })
      if (response.ok) {
        setMeetingsWithActions(prev => prev.map(m => {
          const newActions = m.actions.filter(a => a.action_id !== actionId && a.parent_id !== actionId)
          // If no actions left, update status
          return {
            ...m,
            actions: newActions,
            actions_status: newActions.length === 0 ? 'no_actions' : m.actions_status
          }
        }))
      }
    } catch (error) {
      console.error('Failed to delete action:', error)
    }
  }

  const handleAddAction = async (meetingId, title, parentId, afterActionId) => {
    try {
      const response = await fetch('/api/actions/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId, title, parent_id: parentId, after_action_id: afterActionId })
      })
      if (response.ok) {
        await fetchActions()
      }
    } catch (error) {
      console.error('Failed to add action:', error)
    }
  }

  const handleReorderActions = async (items) => {
    try {
      const response = await fetch('/api/actions/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      })
      if (response.ok) {
        await fetchActions()
      }
    } catch (error) {
      console.error('Failed to reorder actions:', error)
    }
  }

  const buildActionTree = (actions) => {
    const byParent = {}
    actions.forEach(a => {
      const key = a.parent_id ?? '__root__'
      if (!byParent[key]) byParent[key] = []
      byParent[key].push(a)
    })
    
    const buildLevel = (parentId) => {
      const key = parentId ?? '__root__'
      const items = (byParent[key] || []).sort((a, b) => a.sort_order - b.sort_order)
      return items.map(item => ({
        ...item,
        children: buildLevel(item.action_id)
      }))
    }
    
    return buildLevel(null)
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatTime = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit'
    })
  }

  const filteredMeetings = useMemo(() => {
    return meetingsWithActions.filter(meeting => {
      // Text search
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const nameMatch = (meeting.meeting_name || '').toLowerCase().includes(term)
        const speakerMatch = (meeting.speakers || []).some(s => s.toLowerCase().includes(term))
        const actionMatch = (meeting.actions || []).some(a => a.title.toLowerCase().includes(term))
        if (!nameMatch && !speakerMatch && !actionMatch) return false
      }
      
      // Date filter
      if (dateFrom && meeting.start_time) {
        const meetingDate = new Date(meeting.start_time)
        const from = new Date(dateFrom)
        from.setHours(0, 0, 0, 0)
        if (meetingDate < from) return false
      }
      if (dateTo && meeting.start_time) {
        const meetingDate = new Date(meeting.start_time)
        const to = new Date(dateTo)
        to.setHours(23, 59, 59, 999)
        if (meetingDate > to) return false
      }
      
      // Status filter
      if (filter === 'open') {
        const hasOpen = meeting.actions.some(a => !a.checked)
        if (!hasOpen) return false
      } else if (filter === 'completed') {
        if (meeting.actions.length === 0) return false
        const allChecked = meeting.actions.every(a => a.checked)
        if (!allChecked) return false
      }
      
      return true
    })
  }, [meetingsWithActions, searchTerm, dateFrom, dateTo, filter])

  // Summary stats
  const stats = useMemo(() => {
    let totalOpen = 0
    let totalCompleted = 0
    let meetingsWithOpen = 0
    filteredMeetings.forEach(m => {
      const open = m.actions.filter(a => !a.checked).length
      const completed = m.actions.filter(a => a.checked).length
      totalOpen += open
      totalCompleted += completed
      if (open > 0) meetingsWithOpen++
    })
    return { totalOpen, totalCompleted, meetingsWithOpen }
  }, [filteredMeetings])

  const visibleMeetings = filteredMeetings.slice(0, visibleCount)
  const hasMore = filteredMeetings.length > visibleCount

  // Determine if a meeting should be auto-collapsed
  const isMeetingCollapsible = (meeting) => {
    const hasActions = meeting.actions.length > 0
    const allChecked = hasActions && meeting.actions.every(a => a.checked)
    const noActions = meeting.actions_status === 'no_actions'
    const notProcessed = meeting.actions_status === null
    return allChecked || noActions || notProcessed
  }

  const allFilteredChecked = filteredMeetings.length > 0 && 
    filteredMeetings.every(m => m.actions.length === 0 || m.actions.every(a => a.checked))
  const someFilteredChecked = filteredMeetings.some(m => m.actions.some(a => a.checked))

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 h-full flex flex-col">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full flex flex-col">
      <div className="p-4 sm:p-6 bg-gradient-to-br from-amber-50 to-orange-50 border-b border-gray-200 flex-shrink-0 space-y-3">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search meetings, participants, or actions..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(20) }}
            className="w-full px-4 py-2.5 pl-10 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all text-sm"
          />
          <svg className="absolute left-3 top-3 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Filters row with stats */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter chips */}
          <div className="flex bg-white rounded-lg border border-gray-200 p-0.5">
            {['all', 'open', 'completed'].map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); setVisibleCount(20) }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  filter === f
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {(stats.totalOpen > 0 || stats.totalCompleted > 0) && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full text-xs">
                {stats.totalOpen} open
              </span>
              <span className="font-medium text-green-800 bg-green-100 px-2 py-0.5 rounded-full text-xs">
                {stats.totalCompleted} done
              </span>
              <span className="text-xs text-gray-400">
                across {stats.meetingsWithOpen} meeting{stats.meetingsWithOpen !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Bulk actions + Date filters */}
          <div className="flex items-center gap-3 ml-auto">
            {filteredMeetings.some(m => m.actions.length > 0) && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                <input
                  type="checkbox"
                  checked={allFilteredChecked}
                  ref={el => { if (el) el.indeterminate = someFilteredChecked && !allFilteredChecked }}
                  onChange={(e) => handleCheckAllVisible(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                {allFilteredChecked ? 'Uncheck all' : 'Check all'} in view
              </label>
            )}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setVisibleCount(20) }}
                className="px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                title="From date"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setVisibleCount(20) }}
                className="px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                title="To date"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo('') }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-1"
                  title="Clear dates"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-gray-50 min-h-0">
        {filteredMeetings.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              {searchTerm || dateFrom || dateTo || filter !== 'all' ? 'No matching meetings' : 'No meetings yet'}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {searchTerm || dateFrom || dateTo || filter !== 'all' ? 'Try adjusting your filters' : 'Action items will appear here after meetings finish'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4 max-w-3xl mx-auto">
            {visibleMeetings.map(meeting => (
              <MeetingCard
                key={meeting.meeting_id}
                meeting={meeting}
                isGenerating={generatingMeetings.has(meeting.meeting_id) || meeting.actions_status === 'generating'}
                defaultCollapsed={isMeetingCollapsible(meeting)}
                buildActionTree={buildActionTree}
                formatDate={formatDate}
                formatTime={formatTime}
                onToggle={handleToggle}
                onToggleMeeting={handleToggleMeeting}
                onEditAction={handleEditAction}
                onDeleteAction={handleDeleteAction}
                onAddAction={handleAddAction}
                onReorderActions={handleReorderActions}
                activeMenuId={activeMenuId}
                setActiveMenuId={setActiveMenuId}
                onViewTranscript={onViewTranscript}
                onRegenerate={async () => {
                  setGeneratingMeetings(prev => new Set([...prev, meeting.meeting_id]))
                  try {
                    const res = await fetch(`/api/actions/regenerate/${meeting.meeting_id}`, { method: 'POST' })
                    if (res.ok) {
                      let attempts = 0
                      while (attempts < 60) {
                        await new Promise(r => setTimeout(r, 2000))
                        const statusRes = await fetch('/api/actions')
                        if (statusRes.ok) {
                          const all = await statusRes.json()
                          const m = all.find(x => x.meeting_id === meeting.meeting_id)
                          if (m && m.actions_status !== 'generating') break
                        }
                        attempts++
                      }
                    }
                  } catch (e) { console.error('Regenerate failed:', e) }
                  setGeneratingMeetings(prev => { const n = new Set(prev); n.delete(meeting.meeting_id); return n })
                  fetchActions()
                }}
              />
            ))}
            {hasMore && (
              <button
                onClick={() => setVisibleCount(prev => prev + 20)}
                className="w-full py-3 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border-2 border-dashed border-blue-200 hover:border-blue-400 transition-all"
              >
                Load more ({filteredMeetings.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MeetingCard({ meeting, isGenerating, defaultCollapsed, buildActionTree, formatDate, formatTime, onToggle, onToggleMeeting, onEditAction, onDeleteAction, onAddAction, onReorderActions, activeMenuId, setActiveMenuId, onViewTranscript, onRegenerate }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const actionTree = buildActionTree(meeting.actions)
  const hasActions = actionTree.length > 0
  const noActions = meeting.actions_status === 'no_actions'
  const notProcessed = meeting.actions_status === null
  const allChecked = hasActions && meeting.actions.every(a => a.checked)
  const someChecked = meeting.actions.some(a => a.checked)

  return (
    <div className={`bg-white rounded-lg shadow-sm border overflow-hidden ${allChecked && hasActions ? 'border-green-200' : 'border-gray-200'}`}>
      {/* Header - always visible, clickable to collapse/expand */}
      <div
        className={`px-4 py-3 border-b border-gray-200 cursor-pointer select-none ${
          allChecked && hasActions ? 'bg-gradient-to-r from-green-50 to-emerald-50' : 'bg-gradient-to-r from-gray-50 to-blue-50'
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <h3 className={`font-semibold text-sm sm:text-base truncate ${allChecked && hasActions ? 'text-green-800' : 'text-gray-900'}`}>
              {meeting.meeting_name || 'Untitled Meeting'}
            </h3>
            {hasActions && (
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                allChecked
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {meeting.actions.filter(a => a.checked).length}/{meeting.actions.length}
              </span>
            )}
            {isGenerating && (
              <svg className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {hasActions && (
              <button
                onClick={() => onToggleMeeting(meeting.meeting_id, !allChecked)}
                className={`flex items-center p-1.5 rounded-md transition-colors ${
                  allChecked ? 'text-green-600 hover:text-green-800 hover:bg-green-50' : 'text-gray-400 hover:text-amber-700 hover:bg-amber-50'
                }`}
                title={allChecked ? 'Uncheck all' : 'Check all'}
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
                  {allChecked && <path d="M4.5 8.5l2 2 5-5" strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
              </button>
            )}
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="flex items-center p-1.5 text-gray-400 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Regenerate actions"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={() => onViewTranscript && onViewTranscript(meeting.meeting_id)}
              className="flex items-center p-1.5 text-blue-500 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
              title="View transcript"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 ml-6 flex-wrap">
          {meeting.start_time && (
            <span className="text-xs text-gray-500">
              {formatDate(meeting.start_time)} • {formatTime(meeting.start_time)}
            </span>
          )}
          {meeting.speakers && meeting.speakers.length > 0 && (
            <span className="text-xs text-gray-400">
              {meeting.speakers.slice(0, 3).join(', ')}{meeting.speakers.length > 3 ? ` +${meeting.speakers.length - 3}` : ''}
            </span>
          )}
        </div>
      </div>
      
      {/* Body - collapsible */}
      {!collapsed && (
        <div className="p-4">
          {isGenerating ? (
            <div className="flex items-center gap-3 text-gray-600 py-2">
              <svg className="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm">Generating action items...</span>
            </div>
          ) : noActions ? (
            <p className="text-sm text-gray-500 italic py-2">No action items for this meeting</p>
          ) : notProcessed ? (
            <p className="text-sm text-gray-400 italic py-2">Waiting to process...</p>
          ) : hasActions ? (
            <div>
              <div className="space-y-0.5">
                {actionTree.map((action, index) => (
                  <RecursiveAction
                    key={action.action_id}
                    action={action}
                    index={index}
                    meetingId={meeting.meeting_id}
                    onToggle={onToggle}
                    onEdit={onEditAction}
                    onDelete={onDeleteAction}
                    onAdd={onAddAction}
                    onReorder={onReorderActions}
                    allActions={meeting.actions}
                    actionTree={actionTree}
                    activeMenuId={activeMenuId}
                    setActiveMenuId={setActiveMenuId}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic py-2">No action items for this meeting</p>
          )}
        </div>
      )}
    </div>
  )
}

function RecursiveAction({ action, index, meetingId, onToggle, onEdit, onDelete, onAdd, onReorder, allActions, actionTree, activeMenuId, setActiveMenuId }) {
  return (
    <DraggableAction
      action={action}
      index={index}
      isChild={!!action.parent_id}
      parentId={action.parent_id}
      meetingId={meetingId}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
      onAdd={onAdd}
      onReorder={onReorder}
      allActions={allActions}
      actionTree={actionTree}
      activeMenuId={activeMenuId}
      setActiveMenuId={setActiveMenuId}
    >
      {action.children && action.children.length > 0 && (
        <div className="ml-6 sm:ml-8 space-y-0.5">
          {action.children.map((child, ci) => (
            <RecursiveAction
              key={child.action_id}
              action={child}
              index={ci}
              meetingId={meetingId}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAdd={onAdd}
              onReorder={onReorder}
              allActions={allActions}
              actionTree={actionTree}
              activeMenuId={activeMenuId}
              setActiveMenuId={setActiveMenuId}
            />
          ))}
        </div>
      )}
    </DraggableAction>
  )
}

function DraggableAction({ action, index, isChild, parentId, meetingId, onToggle, onEdit, onDelete, onAdd, onReorder, allActions, actionTree, activeMenuId, setActiveMenuId, children }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(action.title)
  const [addingBelow, setAddingBelow] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [newActionTitle, setNewActionTitle] = useState('')
  const dragRef = useRef(null)

  const menuOpen = activeMenuId === action.action_id
  const contextMenu = menuOpen ? true : false

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveMenuId(action.action_id)
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  const closeMenu = () => setActiveMenuId(null)

  useEffect(() => {
    if (menuOpen) {
      const handler = () => closeMenu()
      window.addEventListener('click', handler)
      return () => {
        window.removeEventListener('click', handler)
      }
    }
  }, [menuOpen])

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue.trim() !== action.title) {
      onEdit(action.action_id, editValue.trim())
    }
    setEditing(false)
  }

  const handleAddBelow = () => {
    if (newActionTitle.trim()) {
      onAdd(meetingId, newActionTitle.trim(), isChild ? parentId : null, action.action_id)
      setNewActionTitle('')
      setAddingBelow(false)
    }
  }

  const handleAddChild = () => {
    if (newActionTitle.trim()) {
      onAdd(meetingId, newActionTitle.trim(), action.action_id, null)
      setNewActionTitle('')
      setAddingChild(false)
    }
  }

  // Drag and drop
  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      action_id: action.action_id,
      parent_id: action.parent_id,
      isChild,
      index
    }))
    e.dataTransfer.effectAllowed = 'move'
    e.currentTarget.style.opacity = '0.4'
  }

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('border-t-2', 'border-blue-400')
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('border-t-2', 'border-blue-400')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('border-t-2', 'border-blue-400')
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.action_id === action.action_id) return

      // Build new order: place dragged item before this one at the same level
      const targetParentId = action.parent_id
      const siblings = allActions
        .filter(a => a.parent_id === targetParentId && a.action_id !== data.action_id)
        .sort((a, b) => a.sort_order - b.sort_order)

      const targetIdx = siblings.findIndex(a => a.action_id === action.action_id)
      const reordered = [...siblings]
      reordered.splice(targetIdx, 0, { action_id: data.action_id })

      const items = reordered.map((a, i) => ({
        action_id: a.action_id,
        sort_order: i,
        parent_id: targetParentId
      }))

      onReorder(items)
    } catch (err) {
      console.error('Drop error:', err)
    }
  }

  return (
    <div>
      <div
        ref={dragRef}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
        className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50 group transition-colors cursor-grab active:cursor-grabbing relative"
      >
        {/* Drag handle */}
        <svg className="w-3.5 h-3.5 mt-1 text-gray-300 group-hover:text-gray-400 flex-shrink-0 cursor-grab" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
        </svg>

        <input
          type="checkbox"
          checked={!!action.checked}
          onChange={() => onToggle(action.action_id)}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0"
        />

        {editing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit()
              if (e.key === 'Escape') { setEditValue(action.title); setEditing(false) }
            }}
            className="flex-1 text-sm px-1 py-0 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        ) : (
          <span
            className={`text-sm leading-relaxed flex-1 ${action.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}
            onDoubleClick={() => { setEditValue(action.title); setEditing(true) }}
          >
            {action.title}
          </span>
        )}

        {/* Inline action buttons - visible on hover, positioned on top */}
        <div className="hidden group-hover:flex items-center gap-0.5 absolute right-1 top-1 bg-white border border-gray-200 rounded-md shadow-sm px-0.5 py-0.5 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); setEditValue(action.title); setEditing(true) }}
            className="p-1 text-gray-500 hover:text-blue-600 rounded transition-colors"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(action.action_id) }}
            className="p-1 text-gray-500 hover:text-red-600 rounded transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Context menu */}
        {menuOpen && (
          <div
            className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { closeMenu(); setEditValue(action.title); setEditing(true) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
            <button
              onClick={() => { closeMenu(); setAddingBelow(true); setNewActionTitle('') }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              Add action below
            </button>
            <button
              onClick={() => { closeMenu(); setAddingChild(true); setNewActionTitle('') }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
              Add child action
            </button>
            <div className="border-t border-gray-100 my-1"></div>
            <button
              onClick={() => { closeMenu(); onDelete(action.action_id) }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Add below input */}
      {addingBelow && (
        <div className="flex items-center gap-2 py-1 px-2 ml-5">
          <input
            type="text"
            value={newActionTitle}
            onChange={(e) => setNewActionTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddBelow()
              if (e.key === 'Escape') setAddingBelow(false)
            }}
            placeholder="New action..."
            className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button onClick={handleAddBelow} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Add</button>
          <button onClick={() => setAddingBelow(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      )}

      {/* Children */}
      {children}

      {/* Add child input */}
      {addingChild && (
        <div className="flex items-center gap-2 py-1 px-2 ml-11">
          <input
            type="text"
            value={newActionTitle}
            onChange={(e) => setNewActionTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddChild()
              if (e.key === 'Escape') setAddingChild(false)
            }}
            placeholder="New sub-action..."
            className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button onClick={handleAddChild} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Add</button>
          <button onClick={() => setAddingChild(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      )}
    </div>
  )
}
