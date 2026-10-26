import { getContext, setContext } from 'svelte';
import type { ErrorBoundaryConfig } from './types.js';

const ERROR_BOUNDARY_CONFIG_KEY = Symbol.for('@runlith/error-boundary');

export function provideErrorBoundaryConfig(config: ErrorBoundaryConfig): ErrorBoundaryConfig {
  return setContext(ERROR_BOUNDARY_CONFIG_KEY, config);
}

export function useErrorBoundaryConfig(): ErrorBoundaryConfig | undefined {
  return getContext<ErrorBoundaryConfig>(ERROR_BOUNDARY_CONFIG_KEY);
}
