/** Shared pagination parsing so every list endpoint behaves identically. */
export interface PageParams {
  page: number
  limit: number
  skip: number
}

export function parsePage(
  query: Record<string, unknown>,
  defaultLimit = 20,
  maxLimit = 100,
): PageParams {
  const rawPage = Number.parseInt(String(query.page ?? '1'), 10)
  const rawLimit = Number.parseInt(String(query.limit ?? defaultLimit), 10)

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Math.min(
    Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit),
    maxLimit,
  )

  return { page, limit, skip: (page - 1) * limit }
}

export function pageMeta(total: number, { page, limit }: PageParams): Record<string, unknown> {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) }
}