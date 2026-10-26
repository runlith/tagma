<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';

  let {
    message,
    onDismiss,
    placement = 'pane',
  }: {
    message: string;
    onDismiss?: () => void;
    placement?: 'pane' | 'floor';
  } = $props();
</script>

<div data-terminal-toast data-toast-placement={placement} role="status">
  <FadeText class="toast-words" text={message.split('\n')[0] ?? message} title={message} />
  {#if onDismiss !== undefined}
    <button type="button" data-toast-dismiss aria-label="Dismiss" onclick={onDismiss}>×</button>
  {/if}
</div>

<style>
  [data-terminal-toast] {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    min-width: 0;
    padding: calc(var(--spacing) * 0.5) calc(var(--spacing) * 2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-raised);
    color: var(--color-muted-foreground);
    font-size: var(--text-small);
    pointer-events: auto;
  }
  [data-toast-placement='pane'] {
    position: absolute;
    top: calc(var(--spacing) * 2);
    right: calc(var(--spacing) * 2);
    z-index: 50;
    max-width: 60%;
  }
  [data-toast-placement='floor'] {
    margin: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2) 0;
  }
  :global([data-terminal-toast] .toast-words) {
    flex: 1 1 auto;
  }
  [data-toast-dismiss] {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    font-size: var(--text-body);
    line-height: 1;
    padding: 0;
  }
  [data-toast-dismiss]:hover {
    color: var(--color-foreground);
  }
</style>
