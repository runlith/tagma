<script lang="ts">
  import type { TeamModel } from '@runlith/agent/collaboration/team';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import FadeText from '$lib/shared/FadeText.svelte';
  import TileMeter from '$lib/shared/ui/TileMeter.svelte';
  import type { Rating, RowCheck } from './edits.js';
  import { AXES, favorWords, limitWords, signedWords } from './words.js';

  let {
    row,
    label,
    rung,
    named,
    work,
    review,
    edited,
    open,
    disabled = false,
    oncheck,
    onopen,
  }: {
    row: TeamModel;
    label: string | null;
    rung: string | null;
    named: string;
    work: boolean;
    review: boolean;
    edited: (field: Rating) => boolean;
    open: boolean;
    disabled?: boolean;
    oncheck: (check: RowCheck, value: boolean) => void;
    onopen: () => void;
  } = $props();

  const tail = $derived(limitWords(row));
</script>

<div
  class={['-mx-1.5 flex h-7 items-center gap-2 rounded-md px-1.5 transition-colors', open ? 'bg-selected' : 'hover:bg-hover']}
  data-team-list-row={named}
>
  <span class="flex w-9 shrink-0 justify-center">
    <input
      type="checkbox"
      aria-label={`Agents may start a child on ${named}`}
      title="Agents may start a child on it"
      checked={work}
      {disabled}
      onchange={(event) => oncheck('on', event.currentTarget.checked)}
    />
  </span>
  <span class="flex w-9 shrink-0 justify-center">
    <input
      type="checkbox"
      aria-label={`Agents may start a reviewer on ${named}`}
      title="Agents may start a reviewer on it"
      checked={review}
      {disabled}
      onchange={(event) => oncheck('reviews', event.currentTarget.checked)}
    />
  </span>
  <button type="button" class="flex h-full min-w-0 flex-1 items-center gap-2 text-left select-none" aria-expanded={open} onclick={onopen}>
    <span class={['flex min-w-0 flex-1 items-center gap-2', !work && !review && 'opacity-45']}>
      <FadeText class="w-34 shrink-0 text-ui" text={label ?? ''} />
      <FadeText class="w-12 shrink-0 text-ui text-muted-foreground" text={rung ?? ''} />
      {#each AXES as axis (axis.field)}
        <span class="flex w-15 shrink-0 items-center gap-1">
          <TileMeter count={10} lit={row[axis.field]} />
          <span class={['w-3.5 text-right font-mono text-meta tabular-nums', edited(axis.field) && 'text-mutation']}>{row[axis.field]}</span
          >
        </span>
      {/each}
      <FadeText class="flex-1 text-small text-muted-foreground"
        >{#if row.favor !== 0}<span class="mr-2 text-foreground">{signedWords(row.favor)} {favorWords(row.favor)}</span
          >{/if}{#each tail as words (words)}<span class="mr-2">{words}</span>{/each}</FadeText
      >
    </span>
    {#if open}<ChevronDown class="size-3 shrink-0 text-muted-foreground" />{:else}<ChevronRight
        class="size-3 shrink-0 text-muted-foreground"
      />{/if}
  </button>
</div>
