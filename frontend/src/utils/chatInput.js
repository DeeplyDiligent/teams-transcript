export function getChatInputAction(event, isMobile) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) {
    return 'default'
  }
  if (event.ctrlKey) return 'newline'
  if (isMobile || event.shiftKey || event.altKey || event.metaKey) return 'default'
  return 'send'
}
