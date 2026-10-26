<script lang="ts">
  import type { DebtRow, OwnerRow } from '@tagma/server/enforcement/contract/wire/engines';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { blockLink } from '$lib/features/graph/links.js';
  import type { Link } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import Findings from './Findings.svelte';
  import type { Found } from './found.js';
  import { crossingOf } from './words.js';

  let {
    rows,
    total,
    owners,
    ceiling,
    general,
    more,
    now,
    link,
  }: {
    rows: readonly DebtRow[];
    total: number;
    owners: readonly OwnerRow[];
    ceiling: number | null;
    general: string | null;
    more: (() => void) | null;
    now: number;
    link: (file: string, line: number | null) => Link;
  } = $props();

  type Owed = Found & { readonly debt: DebtRow };

  const addresses = Addresses.use();
  const opening = Opening.use();
  const here = App.current();

  const SCALE = 1700;

  const owedOf = (debt: DebtRow): Owed => {
    const base = { key: debt.fingerprint, at: null, file: debt.file, line: null, fix: null, times: debt.count ?? 1, debt };
    if (ceiling !== null && debt.value !== null) return { ...base, said: debt.file === null ? debt.fingerprint : null };
    const crossing = crossingOf(debt.fingerprint);
    if (crossing.to === null) return { ...base, said: debt.file === null ? debt.fingerprint : null };
    const from = crossing.from === debt.file ? '' : `\`${crossing.from}\` `;
    return { ...base, said: `${from}→ \`${crossing.to}\`${crossing.said === null ? '' : ` · ${crossing.said}`}` };
  };

  const groups = $derived.by(() => {
    const held = new Map<string, Owed[]>();
    for (const row of rows) held.set(row.owner, [...(held.get(row.owner) ?? []), owedOf(row)]);
    return [...held]
      .map(([owner, members]) => ({
        owner,
        found: owners.find((one) => one.name === owner),
        rows: ceiling === null ? members : members.toSorted((left, right) => (right.debt.value ?? 0) - (left.debt.value ?? 0)),
        over: ceiling === null ? null : members.reduce((sum, one) => sum + Math.max(0, (one.debt.value ?? ceiling) - ceiling), 0),
      }))
      .sort((left, right) => right.rows.length - left.rows.length);
  });

  const pct = (value: number): string => `${(Math.min(value, SCALE) / SCALE) * 100}%`;

  const STANDING: Readonly<Record<OwnerRow['standing'], string>> = {
    open: '',
    ended: 'ended, needs a new owner',
    replaced: 'replaced, needs a new owner',
    'not-owner': 'not a task or spec',
    missing: 'not found in this graph',
  };
</script>

{#snippet bar({ debt }: Owed)}
  {#if ceiling !== null && debt.value !== null}
    <span class="relative block h-1.5 w-full rounded-full bg-status-none/20">
      <span class="absolute inset-y-0 left-0 rounded-full bg-status-stale" style:width={pct(debt.value)}></span>
      <span class="absolute -inset-y-1 border-l border-foreground/50" style:left={pct(ceiling)}></span>
    </span>
  {/if}
{/snippet}

<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
  {#each groups as group (group.owner)}
    {@const title = group.found?.title || group.owner}
    <Disclosure open class="min-w-0" summaryClass="h-8 w-full min-w-0 gap-2 px-2 text-ui hover:bg-hover">
      {#snippet summary()}
        <a
          href={addresses.block(group.owner)}
          class="min-w-0 flex-1 text-foreground/90 hover:text-foreground"
          {title}
          {@attach linkTarget(opening, () => blockLink({ name: group.owner }), here)}
        >
          <FadeText text={title} />
        </a>
        {#if group.found && STANDING[group.found.standing] !== ''}
          <span class="shrink-0 text-small text-severity-gap">{STANDING[group.found.standing]}</span>
        {/if}
        <span class="shrink-0 text-small text-muted-foreground tabular-nums">
          {group.rows.length}{group.over === null ? '' : ` · ${group.over} lines over`}
        </span>
      {/snippet}
      <div class="mt-1 mb-2">
        <Findings
          rows={group.rows}
          total={group.rows.length}
          more={null}
          {now}
          {general}
          {link}
          essence={ceiling === null ? undefined : bar}
        >
          {#snippet figure({ debt, times })}
            {#if ceiling !== null && debt.value !== null}
              <span class="text-status-stale">+{debt.value - ceiling}</span>
            {:else if times > 1}×{times}{/if}
          {/snippet}
          {#snippet detail({ debt, said })}
            <p>
              {#if ceiling !== null && debt.value !== null}{debt.value} lines, the rule allows {ceiling}.{/if}
              {#if said !== debt.fingerprint}Known as <code class="font-mono break-all text-foreground/80">{debt.fingerprint}</code>.{/if}
            </p>
          {/snippet}
        </Findings>
      </div>
    </Disclosure>
  {/each}

  {#if more !== null}
    <button type="button" class="justify-self-start px-2 py-1 text-ui text-muted-foreground hover:text-foreground" onclick={() => more?.()}
      >Show {total - rows.length} more</button
    >
  {/if}
</div>
