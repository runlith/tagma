<script lang="ts">
  import { tick } from 'svelte';
  import { clipLabel } from '@runlith/utils/text';
  import { messageTime } from './chatTime';
  import { useChatRendering } from './renderers';
  import type { ChatRewind, ChatRewindTarget } from './rewind';
  import { useChatStrings } from './strings';

  type Props = {
    id: string;
    targets: readonly ChatRewindTarget[];
    active: number;
    rewind: ChatRewind;
    onHover(index: number): void;
    onPick(index: number): void;
  };

  let { id, targets, active, rewind, onHover, onPick }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
  const words = $derived(rewind.words);
  let list: HTMLDivElement | undefined = $state();

  $effect(() => {
    const index = active;
    void tick().then(() => list?.querySelector<HTMLElement>(`[data-pick="${index}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  function status(target: ChatRewindTarget): string {
    if (target.failed) return words.turnFailed();
    if (target.steps > 0) return words.turnSteps(target.steps);
    return target.answered ? words.turnAnswered() : '';
  }
</script>

<div class="px-2 pt-1 pb-1.5 text-small font-medium text-muted-foreground">{words.pickerTitle()}</div>
<div
  bind:this={list}
  {id}
  role="listbox"
  aria-label={words.pickerTitle()}
  class="max-h-[min(18rem,46dvh)] overflow-auto overscroll-contain"
>
  {#each targets as target, index (target.runId)}
    {@const point = rewind.point(target.runId)}
    {@const held = point !== undefined && !point.rewindable}
    <button
      type="button"
      role="option"
      id={`${id}-${index}`}
      data-pick={index}
      aria-selected={index === active}
      aria-disabled={held}
      title={held ? point?.why : target.text}
      class={[
        'grid w-full min-w-0 cursor-pointer grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-l-2 border-transparent px-2 py-1.5 text-left text-ui',
        held
          ? 'cursor-default text-foreground/40'
          : index === active
            ? 'border-primary bg-selected text-foreground'
            : 'text-foreground/80 hover:bg-hover',
      ]}
      onpointerdown={(event) => event.preventDefault()}
      onmouseenter={() => {
        if (!held) onHover(index);
      }}
      onclick={() => {
        if (!held) onPick(index);
      }}
    >
      <span class="font-mono text-meta tabular-nums text-muted-foreground"
        >{target.occurredAt ? messageTime(target.occurredAt, strings.locale) : ''}</span
      >
      <span class="truncate">{clipLabel(target.text.replace(/\s+/g, ' ').trim(), 140)}</span>
      <span class={['font-mono text-meta', target.failed ? 'text-destructive' : 'text-muted-foreground']}
        >{held ? (point?.why ?? '') : status(target)}</span
      >
    </button>
  {/each}
</div>
<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-2 py-1.5 text-small text-muted-foreground">
  <span class="flex items-center gap-1.5">{@render rendering.key({ code: 'Enter', size: 'sm' })}{words.pickRewind()}</span>
  <span class="flex items-center gap-1.5">{@render rendering.key({ code: 'KeyB', size: 'sm' })}{words.pickBranch()}</span>
  <span class="flex items-center gap-1.5">{@render rendering.key({ code: 'Escape', size: 'sm' })}{words.pickClose()}</span>
</div>
