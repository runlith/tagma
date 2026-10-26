import type { ErrorBoundaryContext, ErrorBoundaryContextInput } from './types.js';

const UNKNOWN = 'unknown';

export function normalizeErrorBoundaryContext(input: ErrorBoundaryContextInput): ErrorBoundaryContext {
  return {
    owner: input.owner ?? UNKNOWN,
    routeKey: input.routeKey ?? UNKNOWN,
    buildId: input.buildId ?? UNKNOWN,
    featureFlag: input.featureFlag,
    experimentId: input.experimentId,
    slotId: input.slotId,
    widgetId: input.widgetId,
  };
}

export function getErrorSignature(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}:${error.message}`;
  }
  if (typeof error === 'string') {
    return `string:${error}`;
  }
  return `unknown:${String(error)}`;
}

export function createErrorBoundaryFingerprint(error: unknown, context: { id: string; routeKey: string }): string {
  return `${context.id}|${context.routeKey}|${getErrorSignature(error)}`;
}
