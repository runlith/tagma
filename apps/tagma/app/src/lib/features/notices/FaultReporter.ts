import type {
  ErrorBoundaryContextInput,
  ErrorBoundaryReportLevel,
  ErrorBoundaryReportResult,
  ErrorBoundaryReporter,
} from '@runlith/error-boundary/types';
import type { Notices } from './Service.svelte.js';

export class FaultReporter implements ErrorBoundaryReporter {
  constructor(
    private readonly notices: Notices,
    private readonly console: ErrorBoundaryReporter,
  ) {}

  report(
    error: unknown,
    input: { id: string; context: ErrorBoundaryContextInput },
    options?: { level?: ErrorBoundaryReportLevel | undefined; dedupWindowMs?: number | undefined },
  ): ErrorBoundaryReportResult {
    this.notices.thrown(input.id, error);
    return this.console.report(error, input, options);
  }
}
