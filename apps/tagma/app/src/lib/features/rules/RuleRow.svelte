<script lang="ts">
  import type { EngineRow } from '@tagma/server/enforcement/contract/wire/engines';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import CodeText from '$lib/shared/CodeText.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { blockLink } from '$lib/features/graph/links.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { agoSaid, timeCompact } from '$lib/shared/time.js';
  import { cn } from '$lib/shared/utils.js';
  import { actSaid, checkerName, DELIVERY_WORD, placesSaid, plural, RECENT_MS, STRICTNESS_LABEL, STRICTNESS_WORD } from './words.js';

  let { row, now }: { row: EngineRow; now: number } = $props();

  const addresses = Addresses.use();
  const opening = Opening.use();
  const here = App.current();

  const recent = $derived(row.refused !== null && now - Date.parse(row.refused.at) < RECENT_MS);
  const grew = $derived(row.debt.was !== null && row.debt.was.count < row.debt.count);
  const fell = $derived(row.debt.was !== null && row.debt.was.count > row.debt.count);

  const DOT = {
    gate: 'bg-severity-lie',
    watch: 'border border-severity-gap',
    note: 'bg-status-none/70',
  } as const;

  type Tail = { readonly word: string; readonly tone: string; readonly detail: string };

  const tail = $derived.by((): Tail => {
    const known =
      row.debt.was === null
        ? `${plural(row.debt.count, 'known violation')}`
        : `${plural(row.debt.count, 'known violation')}, was ${row.debt.was.count} ${agoSaid(row.debt.was.until)}`;
    const slipped = `${plural(row.escaped, 'violation')} slipped through`;
    const all = [known, slipped].join(' · ');
    if (row.refused !== null && recent)
      return {
        word: `commit blocked ${timeCompact(row.refused.at, now)}`,
        tone: 'text-severity-lie',
        detail: `Commit blocked ${agoSaid(row.refused.at)} (${actSaid(row.refused.op)}): ${row.refused.file}${row.refused.line === null ? '' : `:${row.refused.line}`} · ${all}`,
      };
    if (row.escaped > 0) return { word: `${row.escaped} slipped through`, tone: 'text-severity-gap', detail: all };
    if (row.debt.count > 0 || grew || fell)
      return {
        word: `${row.debt.count} known${grew ? ' ↑' : fell ? ' ↓' : ''}`,
        tone: grew ? 'text-severity-lie' : row.debt.count > 0 ? 'text-status-stale' : 'text-status-verified',
        detail: all,
      };
    if (!row.enabled) return { word: 'switched off', tone: 'text-muted-foreground/70', detail: DELIVERY_WORD[row.delivery] };
    if (row.checker === null) return { word: 'not checked', tone: 'text-muted-foreground/70', detail: DELIVERY_WORD[row.delivery] };
    return { word: 'clean', tone: 'text-status-verified', detail: 'Nothing slipped through, no known violations' };
  });
</script>

<a
  href={addresses.block(row.rule)}
  class="group/rule flex h-7 min-w-0 items-center gap-3 rounded-md px-2 text-ui transition-colors hover:bg-hover focus-visible:bg-selected focus-visible:outline-none"
  title={`${row.title}\n${placesSaid(row.places)} · ${row.checker === null ? DELIVERY_WORD[row.delivery] : checkerName(row.checker)}`}
  {@attach linkTarget(opening, () => blockLink({ name: row.rule }), here)}
>
  <Tooltip
    text={row.checker === null ? DELIVERY_WORD[row.delivery] : row.strictness === null ? 'cannot be read' : STRICTNESS_WORD[row.strictness]}
  >
    <span class="flex w-16 shrink-0 items-center gap-1.5 text-small text-muted-foreground">
      <span
        class={cn(
          'size-2 shrink-0 rounded-full',
          row.checker === null ? DOT.note : row.strictness === null ? 'bg-muted-foreground/40' : DOT[row.strictness],
        )}
      ></span>
      {row.checker === null || row.strictness === null ? 'Text' : STRICTNESS_LABEL[row.strictness]}
    </span>
  </Tooltip>

  <FadeText class={cn('min-w-0 shrink', row.enabled ? 'text-foreground/90 group-hover/rule:text-foreground' : 'text-muted-foreground/70')}>
    <CodeText text={row.title} />
  </FadeText>

  {#if row.inspection !== null}
    <Tooltip text={row.function ?? (row.enabled ? 'cannot be read' : 'switched off, the key stays named')} class="min-w-0 max-w-48 shrink">
      <FadeText class="font-mono text-small text-muted-foreground/70" text={row.inspection} />
    </Tooltip>
  {/if}

  <span class="min-w-0 flex-1"></span>

  <Tooltip text={tail.detail}>
    <span class={cn('w-36 shrink-0 text-right text-small tabular-nums', tail.tone)}>{tail.word}</span>
  </Tooltip>
</a>
