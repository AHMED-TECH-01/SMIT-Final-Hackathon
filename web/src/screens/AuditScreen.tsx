import { useState } from 'react'
import { api } from '../lib/api'
import { formatDateTime, label } from '../lib/format'
import { useAsync } from '../lib/hooks'
import type { AuditEntry } from '../lib/types'
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
} from '../components/ui'

interface Facets {
  actions: string[]
  entities: string[]
}

const PAGE_SIZE = 50

/**
 * The audit trail.
 *
 * Append-only: the API exposes a read and nothing else, and only administrators
 * hold `audit.read` — so nobody can edit the paper trail of their own actions.
 */
export default function AuditScreen() {
  const [filters, setFilters] = useState({
    action: '',
    entity: '',
    actorEmail: '',
    from: '',
    to: '',
  })
  const [page, setPage] = useState(1)

  const facets = useAsync(() => api.get<Facets>('/audit-log/facets'))
  const entries = useAsync(
    () =>
      api.get<AuditEntry[]>('/audit-log', {
        action: filters.action || undefined,
        entity: filters.entity || undefined,
        actorEmail: filters.actorEmail || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page,
        limit: PAGE_SIZE,
      }),
    [filters.action, filters.entity, filters.actorEmail, filters.from, filters.to, page],
  )

  const total = entries.data?.meta?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(
    filters.action || filters.entity || filters.actorEmail || filters.from || filters.to,
  )

  const update = (patch: Partial<typeof filters>) => {
    setPage(1)
    setFilters((current) => ({ ...current, ...patch }))
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every write in the system, with who did it and from where. Entries are never edited."
      />

      <div className="card p-3 mb-3.5 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
        <Field label="Action">
          <Select value={filters.action} onChange={(event) => update({ action: event.target.value })}>
            <option value="">All actions</option>
            {(facets.data?.data.actions ?? []).map((action) => (
              <option key={action} value={action}>
                {label(action)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Entity">
          <Select value={filters.entity} onChange={(event) => update({ entity: event.target.value })}>
            <option value="">All entities</option>
            {(facets.data?.data.entities ?? []).map((entity) => (
              <option key={entity} value={entity}>
                {label(entity)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Actor">
          <TextInput
            value={filters.actorEmail}
            onChange={(event) => update({ actorEmail: event.target.value })}
            placeholder="admin@example.com"
          />
        </Field>

        <Field label="From">
          <TextInput
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => update({ from: event.target.value })}
          />
        </Field>

        <Field label="To">
          <TextInput
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => update({ to: event.target.value })}
          />
        </Field>
      </div>

      {filtered && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[12px] text-ink-secondary">
            {total} matching entr{total === 1 ? 'y' : 'ies'}
          </span>
          <Button
            variant="ghost"
            className="w-auto px-2.5 py-1 text-[11.5px]"
            onClick={() =>
              update({ action: '', entity: '', actorEmail: '', from: '', to: '' })
            }
          >
            Clear filters
          </Button>
        </div>
      )}

      {entries.loading && <Loading />}
      {entries.error && <Banner tone="danger">{entries.error}</Banner>}

      {entries.data && (
        <Panel title={`Audit trail — ${total}`} description="Newest first" padded={false}>
          {entries.data.data.length === 0 ? (
            <EmptyState
              title="No entries match"
              description="Widen the date range or clear the filters."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {entries.data.data.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</Td>
                    <Td className="text-ink-secondary">{entry.actorEmail ?? 'System'}</Td>
                    <Td>
                      <Badge tone={actionTone(entry.action)}>{label(entry.action)}</Badge>
                    </Td>
                    <Td>
                      <span className="text-ink/85">{label(entry.entity)}</span>
                      {entry.entityId && (
                        <span className="block text-[10px] text-ink-secondary font-mono">
                          {entry.entityId.slice(-8)}
                        </span>
                      )}
                    </Td>
                    <Td className="max-w-[280px]">
                      {entry.meta ? (
                        <span className="text-[11px] text-ink-secondary font-mono break-words">
                          {formatMeta(entry.meta)}
                        </span>
                      ) : (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-secondary font-mono text-[11px]">{entry.ip ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-line/70">
              <span className="text-[11.5px] text-ink-secondary">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-auto px-2.5 py-1 text-[11.5px]"
                  disabled={page === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  className="w-auto px-2.5 py-1 text-[11.5px]"
                  disabled={page >= pages}
                  onClick={() => setPage((value) => Math.min(pages, value + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}

function actionTone(action: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (action) {
    case 'create':
      return 'success'
    case 'update':
      return 'info'
    case 'delete':
      return 'danger'
    case 'login':
    case 'logout':
      return 'neutral'
    default:
      return 'warning'
  }
}

/** Audit meta is arbitrary, so render a compact, readable one-liner. */
function formatMeta(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`
      if (value === null || value === undefined) return `${key}: —`
      if (typeof value === 'object') return `${key}: …`
      return `${key}: ${String(value)}`
    })
    .join(' · ')
}
