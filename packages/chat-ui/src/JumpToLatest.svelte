<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { type ChatStepLine, chatStepLine, chatStepMark, liveMark } from './activity';
  import { clipFade } from './clipFade';
  import { inStep } from './inStep';
  import { LivePeek, type LivePeekValue } from './LivePeek';
  import { type ChatLiveTail, chatLiveLine } from './liveStatus';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';
  import type { VisibleFeed } from './VisibleFeed';

  type Props = {
    feed: VisibleFeed;
    clockOffset: number;
    tail: ChatLiveTail | null;
    still: boolean;
    shown: boolean;
    onJump(): void;
  };

  type Peek = { readonly key: string; readonly line: ChatStepLine; readonly mark: string | null };

  let { feed, clockOffset, tail, still, shown, onJump }: Props = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const selection = $derived(new LivePeek(feed));
  let value = $state<LivePeekValue | null>(null);
  let button: HTMLButtonElement | undefined = $state();
  let width: number | undefined = $state();
  const labelWidths = new SvelteMap<string, number>();

  $effect(() => {
    const status = tail?.kind === 'status' ? tail.status : (tail?.clock ?? null);
    const owner = selection;
    const visible = shown;
    const offset = clockOffset;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const now = Date.now();
      const state = owner.read(status, now, visible, offset);
      value = state.value;
      if (state.nextAt !== null) timer = setTimeout(update, Math.max(0, state.nextAt - now));
    };
    untrack(update);
    return () => clearTimeout(timer);
  });

  const peek = $derived.by((): Peek => {
    if (value === null) return { key: 'quiet', line: { lead: strings.jumpToLatest(), subject: null, join: 'phrase' }, mark: null };
    if (value.kind === 'working')
      return { key: 'working', line: { lead: strings.livePhase('working', null), subject: null, join: 'phrase' }, mark: liveMark(true) };
    if (value.kind === 'status')
      return { key: `status:${value.status.phase}`, line: chatLiveLine(value.status, strings), mark: liveMark(value.status.pulse) };
    const moment = { still, live: value.live, clock: value.clock };
    return {
      key: `step:${value.entry.id}:${value.live}`,
      line: chatStepLine(value.entry, rendering.kinds.identity(value.entry), moment, strings),
      mark: chatStepMark(value.entry, rendering.kinds, moment),
    };
  });
  const marked = $derived(peek.mark !== null);
  const labelWidth = $derived(labelWidths.get(peek.key));

  function fit(): void {
    const target = button;
    if (!target || labelWidth === undefined || !target.parentElement) return;
    const style = getComputedStyle(target);
    const parent = target.parentElement;
    const outer = getComputedStyle(parent);
    let natural = labelWidth;
    for (const child of target.children) {
      if (child.hasAttribute('data-peek-text')) continue;
      natural += child.getBoundingClientRect().width;
    }
    natural +=
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth) +
      parseFloat(style.columnGap) * (target.children.length - 1);
    const available = parent.clientWidth - parseFloat(outer.paddingLeft) - parseFloat(outer.paddingRight);
    width = Math.max(0, Math.ceil(Math.min(natural, parseFloat(style.maxWidth), available)));
  }

  function measureLabel(element: HTMLElement): () => void {
    const key = untrack(() => peek.key);
    const read = () => labelWidths.set(key, element.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      observer.disconnect();
      labelWidths.delete(key);
    };
  }

  $effect(() => {
    button;
    labelWidth;
    marked;
    untrack(fit);
  });

  $effect(() => {
    const parent = button?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  });
</script>

<button
  bind:this={button}
  type="button"
  class={[
    'flex h-7 max-w-md min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-chat-chrome pr-2 pl-3 text-small whitespace-nowrap text-foreground shadow-raised transition-[width] duration-150 ease-instrument',
    shown && 'pointer-events-auto',
  ]}
  style:width={width === undefined ? undefined : `${width}px`}
  title={strings.jumpToLatest()}
  aria-label={strings.jumpToLatest()}
  inert={!shown}
  onclick={onJump}
>
  {#if peek.mark !== null}
    {#key peek.mark}<span class={['size-1.5 shrink-0', peek.mark]} {@attach inStep}></span>{/key}
  {/if}
  <span class="relative h-4 min-w-0 flex-1" data-peek-text data-fade {@attach clipFade}>
    {#key peek.key}
      <span class="absolute top-0 left-0 inline-block w-max" in:fade={{ duration: 120 }} out:fade={{ duration: 120 }} {@attach measureLabel}
        >{#if peek.line.lead !== null}<span class={peek.mark === null ? 'text-foreground' : 'text-foreground/85'}>{peek.line.lead}</span
          >{/if}{#if peek.line.subject}<span
            class={peek.line.join === 'apart' ? 'ml-1.5 text-muted-foreground/70' : peek.line.lead === null ? 'text-foreground/85' : ''}
            >{peek.line.join === 'apart' || peek.line.lead === null ? '' : ' '}{peek.line.subject}</span
          >{/if}{#if peek.line.detail}<span class="text-muted-foreground/70"> {peek.line.detail}</span>{/if}</span
      >
    {/key}
  </span>
  <ArrowDown class="size-3.5 shrink-0" />
</button>
