<script lang="ts">
  import { useChatRendering } from './renderers';

  let {
    open,
    text,
    cacheKey,
  }: {
    open: boolean;
    text: string;
    cacheKey: string;
  } = $props();

  const markdown = useChatRendering().markdown;

  const DURATION_MS = 150;

  let shell: HTMLDivElement | undefined = $state();
  let height = $state(0);
  let mounted = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearCloseTimer(): void {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function measure(): number {
    const el = shell;
    if (!el) return 0;
    return el.offsetHeight;
  }

  $effect(() => {
    if (open) {
      clearCloseTimer();
      mounted = true;
      height = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          height = measure();
        });
      });
      return;
    }

    if (!mounted) return;
    height = 0;
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      mounted = false;
      closeTimer = undefined;
    }, DURATION_MS);
    return () => clearCloseTimer();
  });

  $effect(() => {
    if (!mounted || !open) return;
    const el = shell;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!open) return;
      height = measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

{#if mounted}
  <div class="overflow-hidden ease-out" style={`height:${height}px;transition:height ${DURATION_MS}ms ease-out`}>
    <div bind:this={shell} class="box-border pt-2">
      <div class="max-h-64 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3">
        {@render markdown({ class: 'text-body leading-6 text-foreground/90', cacheKey, text })}
      </div>
    </div>
  </div>
{/if}
