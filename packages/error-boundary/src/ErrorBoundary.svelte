<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import { isHttpError, isRedirect } from '@sveltejs/kit';
  import type {
    ErrorBoundaryConfig,
    ErrorBoundaryContextInput,
    ErrorBoundaryFallbackComponent,
    ErrorBoundaryPolicy,
    ErrorBoundaryPolicyOverrides,
    ErrorBoundaryReporter,
  } from './types.js';
  import { useErrorBoundaryConfig } from './error-boundary-config.svelte.js';
  import { DEFAULT_ERROR_BOUNDARY_REPORTER } from './reporter.js';
  import { getDefaultErrorBoundaryPolicy, resolveErrorBoundaryPolicy } from './policy.js';

  interface Props {
    id: string;
    context?: ErrorBoundaryContextInput;
    policy?: ErrorBoundaryPolicyOverrides;
    reporter?: ErrorBoundaryReporter;
    fallback?: ErrorBoundaryFallbackComponent;
    onRetry?: (() => void | Promise<void>) | undefined;
    isIgnorableError?: (error: unknown) => boolean;
    error?: unknown;
    children?: Snippet;
  }

  let { id, context, policy, reporter, fallback, onRetry, isIgnorableError, error: externalError, children }: Props = $props();

  let config: ErrorBoundaryConfig | undefined;
  try {
    config = useErrorBoundaryConfig();
  } catch {
    config = undefined;
  }

  const policyBase = getDefaultErrorBoundaryPolicy({ isDev: import.meta.env.DEV });

  const effectiveReporter = $derived((reporter ?? config?.reporter ?? DEFAULT_ERROR_BOUNDARY_REPORTER) as ErrorBoundaryReporter);

  const effectivePolicy: ErrorBoundaryPolicy = $derived(
    resolveErrorBoundaryPolicy(policyBase, config?.policy, policy, { fallback: fallback ?? config?.fallback }),
  );

  const isIgnorableErrorEffective = $derived(
    (isIgnorableError ?? config?.isIgnorableError ?? defaultIsIgnorableError) as (error: unknown) => boolean,
  );

  let errorId = $state<string | undefined>(undefined);
  let suppressedCount = $state(0);
  let retryCount = $state(0);
  let retryPending = $state(false);
  let lastError = $state<unknown>(undefined);

  function defaultIsIgnorableError(error: unknown): boolean {
    return isRedirect(error) || isHttpError(error);
  }

  async function retry(reset: () => void): Promise<void> {
    if (retryPending) return;

    retryPending = true;

    try {
      await onRetry?.();
      retryCount += 1;
      reset();
    } catch (error) {
      handleError(error);
    } finally {
      retryPending = false;
    }
  }

  function bubble(error: unknown): never {
    throw error;
  }

  function handleError(error: unknown): void {
    lastError = error;
    errorId = undefined;
    suppressedCount = 0;

    if (isIgnorableErrorEffective(error)) return;
    if (!effectivePolicy.reportingEnabled) return;

    const result = effectiveReporter.report(
      error,
      {
        id,
        context: {
          owner: context?.owner ?? config?.owner,
          routeKey: context?.routeKey ?? config?.getRouteKey?.(),
          buildId: context?.buildId ?? config?.buildId,
          featureFlag: context?.featureFlag,
          experimentId: context?.experimentId,
          slotId: context?.slotId,
          widgetId: context?.widgetId,
        },
      },
      { level: effectivePolicy.reportLevel, dedupWindowMs: effectivePolicy.dedupWindowMs },
    );

    errorId = result.errorId;
    suppressedCount = result.suppressedCount;
  }

  const canRetry = $derived(effectivePolicy.showRetry && !retryPending && retryCount < effectivePolicy.maxRetries);

  const fallbackComponent = $derived(effectivePolicy.fallback as Component<Record<string, unknown>> | undefined);

  const activeError = $derived(externalError ?? lastError);

  const details = $derived.by(() => {
    if (!effectivePolicy.showDetails) return undefined;

    const err = activeError;
    if (effectivePolicy.showStack && err instanceof Error) {
      return err.stack ?? err.message;
    }

    if (err instanceof Error) return err.message;
    if (err) return String(err);
    return undefined;
  });

  const externalErrorDetails = $derived.by(() => {
    const err = externalError;
    if (!err) return undefined;
    if (err instanceof Error) return err.message;
    return String(err);
  });
</script>

{#if externalError && fallbackComponent}
  {@const Fallback = fallbackComponent}
  {@const doRetryExternal = () => {
    void onRetry?.();
  }}
  {@const noop = () => {}}
  <Fallback
    {id}
    error={externalError}
    errorId={undefined}
    suppressedCount={0}
    canRetry={effectivePolicy.showRetry}
    retry={doRetryExternal}
    reset={noop}
    details={externalErrorDetails}
    {children}
  />
{:else}
  <svelte:boundary onerror={handleError}>
    {@render children?.()}

    {#snippet failed(error, reset)}
      {#if isIgnorableErrorEffective(error)}
        {bubble(error)}
      {/if}

      {@const doRetry = () => retry(reset)}

      {#if fallbackComponent}
        {@const Fallback = fallbackComponent}
        <Fallback
          {id}
          {error}
          errorId={effectivePolicy.showErrorId ? errorId : undefined}
          {suppressedCount}
          {canRetry}
          retry={doRetry}
          {reset}
          {details}
          {children}
        />
      {:else}
        <div
          class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          data-testid="error-boundary-fallback"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium">Something went wrong</div>

              {#if effectivePolicy.showErrorId && errorId}
                <div class="mt-1 text-xs opacity-80">Error ID: {errorId}</div>
              {/if}
            </div>

            {#if canRetry}
              <button
                type="button"
                class="shrink-0 rounded-md bg-destructive/20 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/30"
                onclick={doRetry}
              >
                Retry
              </button>
            {/if}
          </div>

          {#if details}
            <pre class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs opacity-80">{details}</pre>
          {/if}
        </div>
      {/if}
    {/snippet}
  </svelte:boundary>
{/if}
