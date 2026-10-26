<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';

  type Kind = 'added' | 'removed' | 'changed';
  type Change = { top: number; bottom: number; start: number; added: boolean; removed: boolean };
  type Mark = { readonly key: number; readonly at: number; readonly top: string; readonly height: string; readonly kind: Kind };

  let { children, class: className }: { children: Snippet; class?: ClassValue } = $props();

  const LINE = 24;
  const BLOCK = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, tr';
  const FILL: Record<Kind, string> = { added: 'bg-status-done', removed: 'bg-severity-lie', changed: 'bg-mutation' };
  const LABEL: Record<Kind, string> = { added: 'Added text', removed: 'Removed text', changed: 'Changed text' };

  let box: HTMLDivElement | undefined = $state();
  let content: HTMLDivElement | undefined = $state();
  let marks = $state.raw<readonly Mark[]>([]);
  let gutter = $state('0px');
  let steered = false;

  function changesIn(scroller: HTMLElement, root: HTMLElement): Change[] {
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const changes: Change[] = [];
    for (const node of root.querySelectorAll('ins, del')) {
      const rect = node.getBoundingClientRect();
      const top = rect.top - origin;
      const bottom = rect.bottom - origin;
      const added = node.tagName === 'INS';
      const last = changes.at(-1);
      if (last !== undefined && top <= last.bottom + LINE) {
        last.bottom = Math.max(last.bottom, bottom);
        last.added ||= added;
        last.removed ||= !added;
        continue;
      }
      const block = node.closest(BLOCK);
      const start = block === null ? top : block.getBoundingClientRect().top - origin;
      changes.push({ top, bottom, start, added, removed: !added });
    }
    return changes;
  }

  function measure(): void {
    const scroller = box;
    if (scroller === undefined || content === undefined) return;
    const changes = changesIn(scroller, content);
    const above = content.offsetTop;
    const landing = (change: Change) => Math.max(0, Math.max(change.start, change.top - scroller.clientHeight / 3) - above);
    if (!steered && changes[0] !== undefined) scroller.scrollTop = landing(changes[0]);
    gutter = `${scroller.offsetWidth - scroller.clientWidth}px`;
    const whole = scroller.scrollHeight;
    marks =
      whole <= scroller.clientHeight + 1
        ? []
        : changes.map((change, key) => ({
            key,
            at: landing(change),
            top: `${(change.top / whole) * 100}%`,
            height: `${((change.bottom - change.top) / whole) * 100}%`,
            kind: change.added && change.removed ? 'changed' : change.added ? 'added' : 'removed',
          }));
  }

  function steer(): void {
    steered = true;
  }

  $effect(() => {
    const scroller = box;
    if (scroller === undefined || content === undefined) return;
    const watch = new ResizeObserver(measure);
    watch.observe(scroller);
    watch.observe(content);
    const intents = ['wheel', 'touchstart', 'pointerdown'] as const;
    for (const intent of intents) scroller.addEventListener(intent, steer, { passive: true });
    return () => {
      watch.disconnect();
      for (const intent of intents) scroller.removeEventListener(intent, steer);
    };
  });
</script>

<div class={['relative min-w-0 overflow-hidden', className]} data-diff-box>
  <div bind:this={box} class="relative max-h-96 overflow-auto px-3 py-2">
    <div bind:this={content}>{@render children()}</div>
  </div>
  {#if marks.length > 0}
    <div class="pointer-events-none absolute inset-y-0 w-1" style:right={gutter} data-diff-marks>
      {#each marks as mark (mark.key)}
        <button
          type="button"
          tabindex="-1"
          class={['pointer-events-auto absolute inset-x-0 min-h-1 opacity-80 transition-opacity hover:opacity-100', FILL[mark.kind]]}
          style:top={mark.top}
          style:height={mark.height}
          aria-label={LABEL[mark.kind]}
          onclick={() => {
            steer();
            box?.scrollTo({ top: mark.at, behavior: 'smooth' });
          }}
        ></button>
      {/each}
    </div>
  {/if}
</div>
