import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'

/** One fact the assistant has retrieved from the database. */
export interface AssistantFact {
  /** Tool name, e.g. 'attendance_today'. */
  name: string
  /** Human label for the card the UI renders next to the answer. */
  label: string
  /** The deterministic sentence built from the query result. */
  summary: string
  data: unknown
}

export interface AssistantPrompt {
  question: string
  /** Deterministic answer assembled from the facts, always available. */
  fallback: string
  facts: AssistantFact[]
  audience: 'admin' | 'hr' | 'employee'
}

export interface AssistantProvider {
  readonly name: string
  /** Returns the answer text. Must never throw. */
  answer(prompt: AssistantPrompt): Promise<string>
}

/**
 * The default provider. It needs no network and no key: the tool layer has
 * already queried the database, so the "intelligence" here is choosing which
 * fact to lead with and phrasing it for the caller's role.
 */
const rulesProvider: AssistantProvider = {
  name: 'rules',
  async answer(prompt) {
    return prompt.fallback
  },
}

const SYSTEM_PROMPT = [
  'You are the HCM Lite assistant for a Pakistani HR system.',
  'Answer in at most three short sentences using only the facts provided.',
  'Quote the numbers exactly as given. Never invent employees, dates or amounts.',
  'If the facts do not answer the question, say what you can help with instead.',
].join(' ')

/** Re-phrases the deterministic answer with an OpenAI-compatible chat model. */
const openAiProvider: AssistantProvider = {
  name: 'openai',
  async answer(prompt) {
    const key = env.AI_API_KEY
    if (!key) return prompt.fallback

    try {
      const response = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: env.AI_MODEL,
          temperature: 0.2,
          max_tokens: 250,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                `Caller role: ${prompt.audience}`,
                `Question: ${prompt.question}`,
                `Facts: ${JSON.stringify(prompt.facts.map((fact) => ({ tool: fact.name, summary: fact.summary, data: fact.data })))}`,
                `Baseline answer: ${prompt.fallback}`,
              ].join('\n'),
            },
          ],
        }),
      })

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Assistant provider returned an error')
        return prompt.fallback
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = payload.choices?.[0]?.message?.content?.trim()
      return text ? text : prompt.fallback
    } catch (err) {
      // A provider outage must never break the assistant.
      logger.warn({ err }, 'Assistant provider call failed; using the deterministic answer')
      return prompt.fallback
    }
  },
}

export function resolveProvider(): AssistantProvider {
  return env.AI_PROVIDER === 'openai' ? openAiProvider : rulesProvider
}