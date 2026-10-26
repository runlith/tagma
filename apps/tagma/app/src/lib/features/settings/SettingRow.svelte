<script lang="ts">
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { sessionName } from '@tagma/server/platform/contract/wire/session';
  import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import SettingControl from '$lib/features/settings/SettingControl.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import type { ScopeLock, ScopeOverride } from '$lib/features/settings/scope.js';
  import { settingText } from '$lib/features/settings/controls/units.js';
  import type { Row, RowNote } from '$lib/features/settings/controls/rows.js';
  import type { SettingAnswer, SettingEntry, WriteOutcome } from '$lib/features/settings/SettingsCatalog.svelte.js';

  let {
    entry,
    answer,
    layerName,
    scope,
    busy = false,
    outcome,
    locked,
    override,
    rowNote,
    onwrite,
    onclear,
    ondecline,
  }: {
    rowNote?: (row: Row) => RowNote | null;
    entry: SettingEntry;
    answer: SettingAnswer;
    layerName: string;
    scope: SettableScope;
    busy?: boolean;
    outcome?: WriteOutcome;
    locked?: ScopeLock;
    override?: ScopeOverride;
    onwrite: (value: unknown) => void;
    onclear: () => void;
    ondecline: (declined: boolean) => void;
  } = $props();

  const SENTENCE_END = /(?<=\.)\s+/;
  const lead = $derived(entry.description.split(SENTENCE_END)[0] ?? entry.description);
  const rest = $derived(entry.description.slice(lead.length).trim());
  let expanded = $state(false);

  const shown = $derived(answer.own === undefined ? answer.inherited : answer.own);
  const chosen = $derived.by(() => {
    const control = entry.control;
    if (control?.kind !== 'choice' || control.multiple) return undefined;
    return control.choices.find((choice) => choice.value === String(shown ?? ''));
  });

  const own = $derived(answer.own !== undefined);
  const resettable = $derived(own && entry.control?.kind !== 'managed' && locked === undefined);
  const wide = $derived(entry.control?.kind === 'rows');
  const inheritedText = $derived(settingText(entry, answer.inherited));
  const below = $derived(answer.inheritedFrom === 'user' ? 'Every project' : 'Tagma default');
  const resetLabel = $derived(`Reset to ${below} (${inheritedText})`);
  const naming = SessionNaming.use();
  const setBy = $derived(answer.writer ? sessionName(answer.writer, naming.identity) : 'you');
  const ownText = $derived(`Set for ${layerName} by ${setBy}`);
  const fromBelow = $derived(scope === 'project' && !own && answer.inheritedFrom === 'user' && locked === undefined);
  const describedBy = $props.id();

  let copied = $state(false);
  let copyFades: ReturnType<typeof setTimeout> | undefined;
  function copyKey(): void {
    void navigator.clipboard?.writeText(entry.id);
    copied = true;
    clearTimeout(copyFades);
    copyFades = setTimeout(() => (copied = false), 1_200);
  }
  $effect(() => () => clearTimeout(copyFades));
</script>

<section
  class="group/row relative grid gap-x-6 gap-y-2 py-3 @xl/settings:grid-cols-[minmax(0,1fr)_auto] @xl/settings:items-start"
  class:opacity-60={locked}
>
  {#if own}
    <Tooltip text="{ownText} · {below}: {inheritedText}" side="left" class="absolute top-2 bottom-2 -left-3 flex w-2 justify-center">
      <span class="block h-full w-0.5 rounded-full bg-brand" aria-hidden="true"></span>
    </Tooltip>
  {/if}

  <div
    class={[
      'relative flex min-w-0 items-center gap-1.5 row-start-2 @xl/settings:justify-end',
      wide ? '@xl/settings:col-span-2' : '@xl/settings:col-start-2 @xl/settings:row-start-1',
    ]}
  >
    <SettingControl {entry} {answer} {layerName} {describedBy} disabled={busy || locked !== undefined} {rowNote} {onwrite} {ondecline} />
    {#if !wide}
      {@render reset(true)}
    {/if}
  </div>

  <div class="row-start-1 grid min-w-0 gap-0.5 @xl/settings:col-start-1">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span class="text-ui font-medium">{entry.title}</span>
      {#if own}<span class="sr-only">{ownText}</span>{/if}
      {#if locked}
        <Tooltip text="Decided {locked.decided}">
          <a
            class="rounded-md bg-selected px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:text-foreground"
            href={locked.href}
          >
            {locked.label}
          </a>
        </Tooltip>
      {:else if fromBelow}
        <Tooltip text="Set for every project; a change here holds for {layerName} alone">
          <span class="rounded-md bg-selected px-1.5 py-0.5 text-small text-muted-foreground">From every project</span>
        </Tooltip>
      {/if}
      {#if override && answer.overriddenBy}
        <Tooltip text="{override.name} sets its own value over this one">
          <a
            class="rounded-md bg-selected px-1.5 py-0.5 text-small text-brand transition-colors hover:text-foreground"
            href={override.href}
          >
            {override.name}: {settingText(entry, answer.overriddenBy.value)}
          </a>
        </Tooltip>
      {/if}
      {#if outcome?.kind === 'saved'}
        <span class="flex items-center gap-1 text-small text-status-done"><Check class="size-3" />Saved</span>
      {/if}
      {#if wide}
        {@render reset(false)}
      {/if}
      <Tooltip text="Copy {entry.id}">
        <button
          type="button"
          class="stamp hidden items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground group-hover/row:flex group-focus-within/row:flex hover:bg-hover hover:text-foreground"
          aria-label={copied ? `Copied ${entry.id}` : `Copy key ${entry.id}`}
          onclick={copyKey}
        >
          {entry.id}
          {#if copied}
            <Check class="size-3 text-status-done" />
          {:else}
            <Copy class="size-3" />
          {/if}
        </button>
      </Tooltip>
    </div>

    <p class="text-small text-muted-foreground">
      <span id={describedBy}>{expanded ? entry.description : lead}</span>
      {#if rest !== ''}
        <button
          type="button"
          class="ml-0.5 font-medium underline-offset-4 hover:text-foreground hover:underline"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
        >
          {expanded ? 'Less' : 'More'}
        </button>
      {/if}
      {#if chosen?.hint}
        <span class="block"><span class="text-foreground">{chosen.label}:</span> {chosen.hint}</span>
      {/if}
    </p>
  </div>

  {#if outcome?.kind === 'refused' || entry.rejection}
    <div class="grid gap-0.5 text-small @xl/settings:col-span-2">
      {#if outcome?.kind === 'refused'}
        <p class="text-destructive" role="alert"><span class="stamp">{outcome.code}</span> — {outcome.reason}</p>
        {#if outcome.unblock[0]}
          <p class="text-muted-foreground">{outcome.unblock[0]}</p>
        {/if}
      {/if}
      {#if entry.rejection}
        <p class="flex flex-wrap items-center gap-x-1.5 text-destructive">
          <span>The {entry.rejection.scope} value could not be read: {entry.rejection.reason}</span>
          {#if entry.rejection.scope === scope && entry.control?.kind !== 'managed'}
            <button type="button" class="underline-offset-4 hover:underline disabled:opacity-50" disabled={busy} onclick={onclear}>
              Reset it
            </button>
          {/if}
        </p>
      {/if}
    </div>
  {/if}
</section>

{#snippet reset(floating: boolean)}
  {#if resettable}
    <Tooltip text={resetLabel}>
      <button
        type="button"
        class={[
          'hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground group-hover/row:grid group-focus-within/row:grid hover:bg-hover hover:text-foreground disabled:opacity-50',
          floating && '@xl/settings:absolute @xl/settings:top-1/2 @xl/settings:right-full @xl/settings:-translate-y-1/2',
        ]}
        aria-label={resetLabel}
        disabled={busy}
        onclick={onclear}
      >
        <RotateCcw class="size-3.5" />
      </button>
    </Tooltip>
  {/if}
{/snippet}
