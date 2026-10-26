<script module lang="ts">
  export const CONTEXT_RING_HOT = 0.8;
</script>

<script lang="ts">
  import { inStep } from './inStep';

  let {
    share,
    compacting = false,
    warm = false,
    label,
    class: className = '',
  }: {
    share: number;
    compacting?: boolean;
    warm?: boolean;
    label: string;
    class?: string;
  } = $props();

  const FRAME = 'M6.5 1.5H11.5V11.5H1.5V1.5Z';

  const hot = $derived(share >= CONTEXT_RING_HOT);
  const filled = $derived((Math.max(0, Math.min(1, share)) * 100).toFixed(2));
</script>

<svg
  class={['size-3.5 shrink-0', hot ? 'text-destructive' : 'text-muted-foreground', className]}
  viewBox="0 0 13 13"
  role="img"
  aria-label={label}
  data-ring
  data-ring-hot={hot || undefined}
  data-ring-warm={warm || undefined}
>
  <rect x="1.5" y="1.5" width="10" height="10" fill="none" stroke="var(--chat-context-track)" stroke-width="2" />
  <path d={FRAME} pathLength="100" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="{filled} 100" />
  {#if compacting}
    <path
      class="travel"
      d={FRAME}
      pathLength="100"
      fill="none"
      stroke="var(--chat-live)"
      stroke-width="2"
      stroke-dasharray="20 80"
      {@attach inStep}
    />
  {/if}
  {#if warm}
    <rect x="4.8" y="4.8" width="3.4" height="3.4" fill="var(--muted-foreground)" />
  {/if}
</svg>

<style>
  .travel {
    animation: travel var(--beat) linear infinite;
  }

  @keyframes travel {
    to {
      stroke-dashoffset: -100;
    }
  }
</style>
