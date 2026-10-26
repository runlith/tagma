import type { ErrorBoundaryPolicy, ErrorBoundaryPolicyOverrides } from './types.js';

export function getDefaultErrorBoundaryPolicy(payload: { isDev: boolean }): ErrorBoundaryPolicy {
  if (payload.isDev) {
    return {
      reportingEnabled: true,
      reportLevel: 'error',
      dedupWindowMs: 5_000,
      showErrorId: true,
      showDetails: true,
      showStack: true,
      showRetry: true,
      maxRetries: 3,
      fallback: undefined,
    };
  }

  return {
    reportingEnabled: true,
    reportLevel: 'error',
    dedupWindowMs: 60_000,
    showErrorId: true,
    showDetails: false,
    showStack: false,
    showRetry: true,
    maxRetries: 1,
    fallback: undefined,
  };
}

export function resolveErrorBoundaryPolicy(
  base: ErrorBoundaryPolicy,
  ...overrides: Array<ErrorBoundaryPolicyOverrides | undefined>
): ErrorBoundaryPolicy {
  let next: ErrorBoundaryPolicy = base;
  for (const override of overrides) {
    if (!override) continue;
    next = {
      ...next,
      ...override,
      fallback: override.fallback ?? next.fallback,
    };
  }
  return next;
}
