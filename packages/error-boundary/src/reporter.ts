import { createErrorBoundaryFingerprint, normalizeErrorBoundaryContext } from './fingerprint.js';
import type { ErrorBoundaryContextInput, ErrorBoundaryReportLevel, ErrorBoundaryReportResult, ErrorBoundaryReporter } from './types.js';

type CacheEntry = {
  lastReportedAt: number;
  suppressedCount: number;
  errorId: string;
};

export class ConsoleErrorBoundaryReporter implements ErrorBoundaryReporter {
  private readonly dedupWindowMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private counter = 0;

  constructor(options?: { dedupWindowMs?: number | undefined; now?: (() => number) | undefined }) {
    this.dedupWindowMs = options?.dedupWindowMs ?? 60_000;
    this.now = options?.now ?? (() => Date.now());
  }

  report(
    error: unknown,
    input: { id: string; context: ErrorBoundaryContextInput },
    options?: { level?: ErrorBoundaryReportLevel | undefined; dedupWindowMs?: number | undefined },
  ): ErrorBoundaryReportResult {
    const context = normalizeErrorBoundaryContext(input.context);
    const fingerprint = createErrorBoundaryFingerprint(error, { id: input.id, routeKey: context.routeKey });
    const now = this.now();
    const windowMs = options?.dedupWindowMs ?? this.dedupWindowMs;

    const existing = this.cache.get(fingerprint);
    if (existing && now - existing.lastReportedAt < windowMs) {
      existing.suppressedCount += 1;
      return {
        errorId: existing.errorId,
        fingerprint,
        suppressed: true,
        suppressedCount: existing.suppressedCount,
        context,
      };
    }

    const errorId = existing?.errorId ?? this.createErrorId(now);
    this.cache.set(fingerprint, { lastReportedAt: now, suppressedCount: existing?.suppressedCount ?? 0, errorId });

    const level: ErrorBoundaryReportLevel = options?.level ?? 'error';
    const logFn = level === 'warn' ? console.warn : console.error;
    logFn('[UI ErrorBoundary]', { errorId, id: input.id, context, fingerprint, error });

    return {
      errorId,
      fingerprint,
      suppressed: false,
      suppressedCount: existing?.suppressedCount ?? 0,
      context,
    };
  }

  private createErrorId(now: number): string {
    this.counter += 1;
    return `${now.toString(36)}-${this.counter.toString(36)}`;
  }
}

export const DEFAULT_ERROR_BOUNDARY_REPORTER: ErrorBoundaryReporter = new ConsoleErrorBoundaryReporter({
  dedupWindowMs: 60_000,
});
