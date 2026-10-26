import type { Component, Snippet } from 'svelte';

export type ErrorBoundaryContextInput = {
  owner?: string | undefined;
  routeKey?: string | undefined;
  buildId?: string | undefined;
  featureFlag?: string | undefined;
  experimentId?: string | undefined;
  slotId?: string | undefined;
  widgetId?: string | undefined;
};

export type ErrorBoundaryContext = {
  owner: string;
  routeKey: string;
  buildId: string;
  featureFlag?: string | undefined;
  experimentId?: string | undefined;
  slotId?: string | undefined;
  widgetId?: string | undefined;
};

export type ErrorBoundaryReportLevel = 'warn' | 'error';

export type ErrorBoundaryFallbackProps = {
  id: string;
  error: unknown;
  errorId?: string | undefined;
  suppressedCount?: number | undefined;
  canRetry: boolean;
  retry: () => void | Promise<void>;
  reset: () => void;
  details?: string | undefined;
  children?: Snippet | undefined;
};

export type ErrorBoundaryFallbackComponent = Component<ErrorBoundaryFallbackProps>;

export type ErrorBoundaryPolicy = {
  reportingEnabled: boolean;
  reportLevel: ErrorBoundaryReportLevel;
  dedupWindowMs: number;
  showErrorId: boolean;
  showDetails: boolean;
  showStack: boolean;
  showRetry: boolean;
  maxRetries: number;
  fallback?: ErrorBoundaryFallbackComponent | undefined;
};

export type ErrorBoundaryPolicyOverrides = Partial<Omit<ErrorBoundaryPolicy, 'fallback'>> & {
  fallback?: ErrorBoundaryFallbackComponent | undefined;
};

export type ErrorBoundaryReportResult = {
  errorId: string;
  fingerprint: string;
  suppressed: boolean;
  suppressedCount: number;
  context: ErrorBoundaryContext;
};

export interface ErrorBoundaryReporter {
  report(
    error: unknown,
    input: { id: string; context: ErrorBoundaryContextInput },
    options?: { level?: ErrorBoundaryReportLevel | undefined; dedupWindowMs?: number | undefined },
  ): ErrorBoundaryReportResult;
}

export type ErrorBoundaryConfig = {
  owner?: string | undefined;
  buildId?: string | undefined;
  getRouteKey?: (() => string | undefined) | undefined;
  reporter?: ErrorBoundaryReporter | undefined;
  policy?: ErrorBoundaryPolicyOverrides | undefined;
  fallback?: ErrorBoundaryFallbackComponent | undefined;
  isIgnorableError?: ((error: unknown) => boolean) | undefined;
};
