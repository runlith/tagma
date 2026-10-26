<script lang="ts">
  import { App } from '@runlith/layer/sveltekit';
  import { provideErrorBoundaryConfig } from '@runlith/error-boundary/error-boundary-config.svelte';
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import { ConsoleErrorBoundaryReporter } from '@runlith/error-boundary/reporter';
  import type { Component, Snippet } from 'svelte';
  import type { AccessRefusal } from '@tagma/server/remote/contract/wire/access';
  import FailedPart from './chrome/FailedPart.svelte';
  import { FaultReporter } from '$lib/features/notices/FaultReporter.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { runtime } from './runtime.js';
  import Window from './Window.svelte';

  let { Shell, refusal, children }: { Shell: Component<{ children: Snippet }>; refusal: AccessRefusal | null; children: Snippet } =
    $props();

  App.mount(runtime);
  const notices = Notices.use();

  provideErrorBoundaryConfig({
    reporter: new FaultReporter(notices, new ConsoleErrorBoundaryReporter()),
    fallback: FailedPart,
    policy: { maxRetries: Number.POSITIVE_INFINITY },
  });

  $effect(() => {
    const uncaught = (event: ErrorEvent): void => {
      if (event.error !== null && event.error !== undefined) notices.thrown('uncaught error', event.error);
    };
    const unhandled = (event: PromiseRejectionEvent): void => notices.thrown('unhandled rejection', event.reason);
    window.addEventListener('error', uncaught);
    window.addEventListener('unhandledrejection', unhandled);
    return () => {
      window.removeEventListener('error', uncaught);
      window.removeEventListener('unhandledrejection', unhandled);
    };
  });
</script>

<ErrorBoundary id="window">
  <Window {Shell} {refusal}>{@render children()}</Window>
</ErrorBoundary>
