import ReactMarkdown from 'react-markdown'

export default function ChatResponse({ content }) {
  return (
    <article className="prose mb-4 sm:mb-6 prose-sm max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-code:text-pink-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs sm:prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:text-xs sm:prose-pre:text-sm prose-pre:overflow-x-auto">
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  )
}
