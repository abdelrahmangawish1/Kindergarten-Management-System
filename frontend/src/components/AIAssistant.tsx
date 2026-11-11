import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { apiUrl } from '../lib/api'
import { useLocale } from '../lib/i18n'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function AIAssistant({ token, role }: { token: string; role: 'ADMIN' | 'TEACHER' }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'mock' | 'openai' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { t } = useLocale()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy) return

    const conversation = [...messages, { role: 'user' as const, content }]
    const requestMessages = conversation.slice(-6)
    setInput('')
    setError('')
    setBusy(true)
    setMessages([...conversation, { role: 'assistant', content: '' }])

    try {
      const response = await fetch(apiUrl('/ai/chat'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: requestMessages }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? t('Could not reach the AI assistant'))
      }
      if (!response.body) throw new Error(t('The AI assistant returned an empty response'))
      setMode(response.headers.get('X-AI-Mode') === 'openai' ? 'openai' : 'mock')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let answer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        answer += decoder.decode(value, { stream: true })
        setMessages([...conversation, { role: 'assistant', content: answer }])
      }
      answer += decoder.decode()
      setMessages([...conversation, { role: 'assistant', content: answer }])
    } catch (requestError) {
      setMessages(conversation)
      setError(requestError instanceof Error ? requestError.message : t('Could not reach the AI assistant'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-assistant">
      {open && <section className="ai-assistant-panel" aria-label={t('AI Assistant')} aria-live="polite">
        <header className="ai-assistant-header">
          <div className="ai-assistant-title-icon"><Sparkles size={18} /></div>
          <div className="ai-assistant-title">
            <strong>{t('AI Assistant')}</strong>
            <span>{t('Kindergarten Management Assistant')} · {t(role === 'ADMIN' ? 'Admin' : 'Teacher')}</span>
          </div>
          {mode && <span className={`ai-assistant-mode ${mode}`}>{t(mode === 'openai' ? 'AI' : 'Demo')}</span>}
          <button type="button" className="ai-assistant-close" onClick={() => setOpen(false)} aria-label={t('Close AI Assistant')}><X size={18} /></button>
        </header>

        <div className="ai-assistant-messages" ref={scrollRef}>
          {!messages.length && <div className="ai-assistant-welcome">
            <div className="ai-assistant-welcome-icon"><Bot size={23} /></div>
            <strong>{t('How can I help today?')}</strong>
            <p>{t('Ask for homework ideas, age-appropriate activities, or an overview of your workspace stats.')}</p>
            <span>{t('Your workspace context is limited to your role and aggregate classroom statistics.')}</span>
          </div>}
          {messages.map((message, index) => <article className={`ai-assistant-message ${message.role}`} key={`${index}-${message.role}`}>
            {message.role === 'assistant' && <Bot size={15} aria-hidden="true" />}
            <p>{message.content || (busy && index === messages.length - 1 ? <LoaderCircle className="ai-assistant-spinner" size={16} /> : '')}</p>
          </article>)}
          {error && <div className="ai-assistant-error" role="alert">{t(error)}</div>}
        </div>

        <form className="ai-assistant-form" onSubmit={(event) => void sendMessage(event)}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder={t('Ask the AI Assistant…')}
            aria-label={t('Message the AI Assistant')}
            rows={2}
            maxLength={3000}
            disabled={busy}
          />
          <button type="submit" className="workspace-primary-button" aria-label={t('Send message')} disabled={!input.trim() || busy}><Send size={16} /></button>
        </form>
        <footer className="ai-assistant-footnote">{t('AI responses may need review. Avoid including identifiable child information.')}</footer>
      </section>}

      <button
        type="button"
        className={`ai-assistant-launcher${open ? ' open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={t(open ? 'Close AI Assistant' : 'Open AI Assistant')}
      >
        {open ? <X size={20} /> : <><MessageCircle size={19} /><span>{t('AI Assistant')}</span></>}
      </button>
    </div>
  )
}
