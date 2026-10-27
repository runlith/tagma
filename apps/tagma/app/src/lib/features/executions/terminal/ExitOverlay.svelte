<script module lang="ts">
  import type { ChildEnding } from './RecordStream.svelte.js';

  export interface ExitCopy {
    readonly heading: string;
    readonly detail: string;
  }

  export function exitCopy(
    ending: ChildEnding,
    named: string | null = null,
    preserved: 'output' | 'screen' = named === null ? 'output' : 'screen',
  ): ExitCopy {
    const who = named ?? 'Terminal';
    const process = named === null ? 'The shell process' : `The ${named} process`;
    const kept = `Its ${preserved} is preserved.`;
    if (ending._tag === 'None') {
      return { heading: `${who} exited`, detail: `${process} ended. ${kept}` };
    }
    if (ending._tag === 'HostEnded') {
      return { heading: `${who} ended`, detail: `${process} ended with the execution host it ran in, which was replaced. ${kept}` };
    }
    if (ending._tag === 'Unread') {
      return { heading: `${who} exited`, detail: `${process} ended, but its exit could not be read. ${kept}` };
    }
    return {
      heading: `${who} exited`,
      detail:
        ending.native._tag === 'Code'
          ? `${process} ended with exit code ${String(ending.native.code)}. ${kept}`
          : `${process} was killed by ${ending.native.signal}. ${kept}`,
    };
  }

  export function exitLine(ending: ChildEnding, named: string | null = null): string {
    const who = named ?? 'Terminal';
    if (ending._tag === 'HostEnded') return `${who} ended with its execution host, which was replaced`;
    if (ending._tag !== 'Exit') return `${who} exited`;
    return ending.native._tag === 'Code'
      ? `${who} exited with code ${String(ending.native.code)}`
      : `${who} was killed by ${ending.native.signal}`;
  }
</script>

<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';

  let {
    ending,
    named = null,
    onRestart,
    onClose,
  }: {
    ending: ChildEnding;
    named?: string | null;
    onRestart?: () => void;
    onClose: () => void;
  } = $props();

  const line = $derived(exitLine(ending, named));
</script>

<div data-exit-line role="status">
  <FadeText class="exit-words" text={line} />
  <div data-exit-acts>
    {#if onRestart !== undefined}
      <button type="button" data-exit-restart onclick={onRestart}>Restart</button>
    {/if}
    <button type="button" data-exit-close onclick={onClose}>Close</button>
  </div>
</div>

<style>
  [data-exit-line] {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 3);
    height: var(--pane-foot-height);
    padding: 0 calc(var(--spacing) * 3);
    border-top: 1px solid var(--color-border);
    background: var(--color-raised);
    color: var(--color-muted-foreground);
    font-size: var(--text-small);
  }
  :global([data-exit-line] .exit-words) {
    flex: 1 1 auto;
  }
  [data-exit-acts] {
    display: flex;
    flex-shrink: 0;
    gap: calc(var(--spacing) * 3);
  }
  [data-exit-acts] button {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    font-size: var(--text-small);
    padding: 0;
  }
  [data-exit-acts] button:hover {
    color: var(--color-foreground);
  }
</style>
