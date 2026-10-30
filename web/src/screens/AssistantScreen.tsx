import { useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { AssistantReply } from '../lib/types'
import { Banner, Button, Loading, PageHeader, Panel, TextInput } from '../components/ui'
import { IconBot, IconSend } from '../components/icons'

interface Turn {
  id: number
  question: string
  reply?: AssistantReply
  error?: string
}

/**
 * The assistant.
 *
 * Answers come from the API's own tools over the live database — the model, when
 * one is configured, only rephrases. So this screen never shows a number that
 * the dashboards would disagree with, and it keeps working with no API key.
 */
export default function AssistantScreen() {
  const { session } = useSession()
  const suggestions = useAsync(
    () => api.get<{ suggestions: string[] }>('/assistant/suggestions'),
    [],
  )

  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const { run, busy, error } = useAction()
  const nextId = useRef(1)

  const ask = async (text: string) => {
    const prompted = text.trim()
    if (prompted.length < 2) return

    const id = nextId.current++
    setQuestion('')
    setTurns((current) => [...current, { id, question: prompted }])

    const ok = await run(() =>
      api.post<AssistantReply>('/assistant/chat', { message: prompted }).then((response) => {
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, reply: response.data } : turn)),
        )
        return response
      }),
    )

    if (!ok) {
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, error: 'No answer could be produced.' } : turn)),
      )
    }
  }

  const canSeeCompany = session?.user.role !== 'employee'

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about headcount, attendance, approvals, payroll or your own leave — answers come from the live records."
      />

      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {!canSeeCompany && (
        <div className="mb-3">
          <Banner tone="info">
            Your account can ask about its own leave balance. Company-wide figures are limited to HR
            and administrators.
          </Banner>
        </div>
      )}

      <Panel title="Conversation" description="Suggestions are tailored to your role.">
        {turns.length === 0 && (
          <div className="py-6 text-center">
            <span className="inline-grid place-items-center w-11 h-11 rounded-xl bg-primary-light text-primary mb-3">
              <IconBot className="w-6 h-6" />
            </span>
            <p className="text-[13.5px] font-semibold text-ink">Ask the first question</p>
            <p className="text-[12.5px] text-ink-secondary mt-1">
              Nothing leaves this system: every answer is assembled from the database.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {turns.map((turn) => (
            <div key={turn.id}>
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-ctrl bg-primary text-white px-3.5 py-2 text-[12.5px]">
                  {turn.question}
                </div>
              </div>

              <div className="flex justify-start mt-2">
                <div className="max-w-[92%] w-full rounded-ctrl border border-line bg-surface-muted/50 px-3.5 py-2.5">
                  {turn.reply ? (
                    <>
                      <p className="text-[12.5px] text-ink/90 whitespace-pre-line">{turn.reply.answer}</p>

                      {turn.reply.tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="mt-2 rounded-ctrl border border-line bg-white px-3 py-2"
                        >
                          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-secondary">
                            {tool.label}
                          </div>
                          <div className="text-[12px] text-ink/85 mt-0.5">{tool.summary}</div>
                        </div>
                      ))}

                      <div className="mt-2 text-[10.5px] text-ink-secondary">
                        Intent: {turn.reply.intent} · Provider: {turn.reply.provider}
                      </div>
                    </>
                  ) : turn.error ? (
                    <p className="text-[12.5px] text-danger">{turn.error}</p>
                  ) : (
                    <Loading label="Looking it up…" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <form
          className="flex items-end gap-2 mt-4"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(question)
          }}
        >
          <TextInput
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="How many employees do we have?"
            maxLength={500}
          />
          <Button type="submit" loading={busy} disabled={question.trim().length < 2}>
            <IconSend className="w-4 h-4" /> Ask
          </Button>
        </form>
      </Panel>

      <Panel title="Try asking" className="mt-3.5">
        {suggestions.loading && <Loading />}
        {suggestions.error && <Banner tone="danger">{suggestions.error}</Banner>}
        <div className="flex flex-wrap gap-2">
          {(suggestions.data?.data.suggestions ?? []).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void ask(suggestion)}
              disabled={busy}
              className="rounded-full border border-line bg-white px-3 py-1.5 text-[12px] text-ink/80 hover:bg-surface-muted disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </Panel>
    </>
  )
}
