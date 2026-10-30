/**
 * Minimal fixed-window rate limiter.
 *
 * Chosen over a third-party middleware so the behaviour is small, dependency
 * free, and directly unit-testable without HTTP. Keys are typically an IP or
 * `ip:email` pair.
 */
export interface LimiterResult {
  limited: boolean
  remaining: number
  /** Seconds until the window resets. */
  retryAfter: number
}

export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one attempt and reports whether the caller is now throttled. */
  hit(key: string): LimiterResult {
    const now = this.now()
    const existing = this.hits.get(key)

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return {
        limited: false,
        remaining: Math.max(0, this.max - 1),
        retryAfter: Math.ceil(this.windowMs / 1000),
      }
    }

    existing.count += 1
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))

    if (existing.count > this.max) {
      return { limited: true, remaining: 0, retryAfter }
    }

    return { limited: false, remaining: this.max - existing.count, retryAfter }
  }

  /** Clears a key — used after a successful login and between tests. */
  reset(key: string): void {
    this.hits.delete(key)
  }

  resetAll(): void {
    this.hits.clear()
  }

  /** Drops expired windows so the map cannot grow without bound. */
  sweep(): void {
    const now = this.now()
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key)
    }
  }
}
