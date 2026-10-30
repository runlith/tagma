<script lang="ts">
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { NOT_INSTALLED } from '$lib/features/providers/served.js';
  import { harnessWords, modelIdentity, modelWords } from './modelWords.js';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { STOWED, Stow } from '../squeeze.svelte.js';
  import HarnessMark from './HarnessMark.svelte';

  let {
    row,
    query = '',
    same = false,
    step = 0,
    class: className = '',
  }: { row: ThreadListRow; query?: string; same?: boolean; step?: number; class?: string } = $props();

  const catalog = ProviderCatalog.use();
  const harness = $derived(
    row.harness === null
      ? null
      : {
          presentation: row.harness.presentation,
          terminal: row.harness.transport === 'terminal',
          ...harnessWords(catalog.models, row.harness),
        },
  );
  const words = $derived(modelWords(catalog.models, row));
  const absent = $derived(harness === null && catalog.installed(words.provider) === false);
  const identity = $derived(`${modelIdentity(catalog.models, row)}${absent ? ` · ${NOT_INSTALLED}` : ''}${same ? ' — as its parent' : ''}`);

  const PLATE = 'inline-flex shrink-0 items-center gap-1 text-small leading-[14px] text-muted-foreground';
  const NAME = 'whitespace-nowrap';
  const EFFORT = 'whitespace-nowrap text-muted-foreground/60';

  const plate = $derived([PLATE, same && 'opacity-55', step >= Stow.plate && STOWED, className]);
  const name = $derived([NAME, step >= Stow.model && STOWED]);
  const effort = $derived([EFFORT, step >= Stow.effort && STOWED]);
</script>

{#if harness !== null}
  <span class={plate} aria-label={identity} data-plate data-plate-same={same || undefined} data-squeeze-piece={Stow.plate}>
    <HarnessMark presentation={harness.presentation} class="size-3 shrink-0" />
    <span
      class={[name, harness.model.value !== null && !harness.model.current && 'opacity-60']}
      data-plate-name
      data-squeeze-piece={Stow.model}
    >
      <MatchText text={harness.short ?? harness.label} {query} />
    </span>
    {#if harness.effort.value !== null}
      <span class={[effort, !harness.effort.current && 'opacity-60']} data-plate-effort data-squeeze-piece={Stow.effort}>
        <MatchText text={harness.effort.value.toLowerCase()} {query} />
      </span>
    {/if}
    {#if harness.terminal}
      <SquareTerminal class="size-3 shrink-0" aria-label="In a terminal" />
    {/if}
  </span>
{:else}
  <span class={plate} aria-label={identity} data-plate data-plate-same={same || undefined} data-squeeze-piece={Stow.plate}>
    <ProviderMark provider={words.provider} class="size-3 shrink-0" titled={false} />
    <span class={[name, absent && 'opacity-60']} data-plate-name data-squeeze-piece={Stow.model}
      ><MatchText text={words.model.short} {query} /></span
    >
    {#if words.rung !== null}
      <span class={[effort, absent && 'opacity-60']} data-plate-effort data-squeeze-piece={Stow.effort}
        ><MatchText text={words.rung.id.toLowerCase()} {query} /></span
      >
    {/if}
  </span>
{/if}
