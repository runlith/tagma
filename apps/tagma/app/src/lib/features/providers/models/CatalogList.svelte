<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import Star from '@lucide/svelte/icons/star';
  import type { ModelSwitches } from '@runlith/llm/models/description';
  import { Host } from '@runlith/layer/Host';
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import UsageGauge from '$lib/features/providers/usage/Gauge.svelte';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { glide, Reorder } from '$lib/shared/Reorder.svelte.js';
  import { spellKey } from '$lib/shared/chordSpelling.js';
  import InlineSvg from '$lib/shared/ui/InlineSvg.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Rungs from '../../../shared/models/Rungs.svelte';
  import {
    choiceKey,
    type ModelChoice,
    type ModelFlag,
    type ModelGesture,
    type ModelLead,
    type ModelToggle,
    rankChoices,
  } from '../../../shared/models/choice.js';

  let {
    choices,
    lead = [],
    current = null,
    starred = [],
    query: opening = '',
    title = null,
    queueAction = null,
    empty = null,
    busy = false,
    autofocus = true,
    heading,
    detail,
    onpick,
    onstar,
    onreorder,
    onswitch,
    onclose,
  }: {
    choices: readonly ModelChoice[];
    lead?: readonly ModelLead[];
    current?: string | null;
    starred?: readonly string[];
    query?: string;
    title?: string | null;
    queueAction?: string | null;
    empty?: string | null;
    busy?: boolean;
    autofocus?: boolean;
    heading?: Snippet<[string, string]>;
    detail?: Snippet<[ModelChoice, string | null]>;
    onpick: (choice: ModelChoice, rung: string | null, gesture: ModelGesture, switches: ModelSwitches) => void;
    onstar?: (provider: string, model: string) => void;
    onreorder?: (choice: ModelChoice, before: ModelChoice | null) => void;
    onswitch?: (choice: ModelChoice, id: string, value: string) => void;
    onclose?: () => void;
  } = $props();

  type Row = {
    readonly kind: 'row';
    readonly key: string;
    readonly choice: ModelChoice;
    readonly marked: boolean;
    readonly named: boolean;
  };
  type Line =
    | { readonly kind: 'lead'; readonly key: string; readonly label: string; readonly starred: boolean; readonly note: string | null }
    | { readonly kind: 'provider'; readonly key: string; readonly provider: string; readonly label: string }
    | { readonly kind: 'sortable'; readonly key: string; readonly rows: readonly Row[] }
    | Row;
  type Tab =
    | { readonly kind: 'lead'; readonly key: string }
    | {
        readonly kind: 'provider';
        readonly key: string;
        readonly label: string;
        readonly lead: string;
        readonly providers: readonly string[];
      };

  const LEAD_TAB = 'lead';
  const listId = $props.id();
  const touch = Host.use().touch;
  const apple = Host.use().apple;
  const catalog = ProviderCatalog.use();
  const accounts = UsageAccounts.use();
  const HEADING = 'eyebrow flex items-center gap-1.5 px-2 pt-2 pb-1 text-muted-foreground';
  const TONE: Record<ModelFlag['tone'], string> = {
    good: 'text-status-done',
    warn: 'text-status-in-work',
    bad: 'text-severity-lie',
    muted: 'text-muted-foreground',
  };

  let query = $state(untrack(() => opening));
  let cursor = $state<string | null>(null);
  let rungs = $state<Record<string, string>>({});
  let flips = $state<Record<string, Record<string, string>>>({});
  let picked = $state<string | null>(null);
  let search: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  let rail: HTMLDivElement | undefined = $state();

  const typed = $derived(query.trim() !== '');
  const pinned = $derived(new Set(starred));
  const hasLadder = $derived(choices.some((choice) => choice.ladder.length > 0));

  const leadSections = $derived.by(() => {
    const byKey = new Map(choices.map((choice) => [choiceKey(choice.provider, choice.model), choice]));
    const shown = new Set<string>();
    return lead
      .map((section) => ({
        section,
        choices: section.keys.flatMap((key) => {
          const choice = byKey.get(key);
          if (choice === undefined || shown.has(key)) return [];
          shown.add(key);
          return [choice];
        }),
      }))
      .filter((led) => led.choices.length > 0);
  });

  const tabs = $derived.by<readonly Tab[]>(() => {
    const out: Tab[] = leadSections.length === 0 ? [] : [{ kind: 'lead', key: LEAD_TAB }];
    const labels = new Map<string, string>();
    for (const choice of choices) if (!labels.has(choice.provider)) labels.set(choice.provider, choice.providerLabel);
    const byKey = new Map<string, { label: string; providers: string[]; selected: string | null }>();
    for (const [provider, label] of labels) {
      const section = catalog.section(provider);
      const key = section?.id ?? `provider:${provider}`;
      const tab = byKey.get(key);
      if (tab === undefined) {
        byKey.set(key, {
          label: section?.title ?? label,
          providers: [provider],
          selected: section?.options.find((option) => option.id === section.selected)?.provider ?? null,
        });
      } else tab.providers.push(provider);
    }
    for (const [key, tab] of byKey) {
      const leadProvider = tab.selected !== null && tab.providers.includes(tab.selected) ? tab.selected : tab.providers[0]!;
      out.push({ kind: 'provider', key, label: tab.label, lead: leadProvider, providers: tab.providers });
    }
    return out;
  });

  const currentProvider = $derived(
    current === null ? null : (choices.find((choice) => choiceKey(choice.provider, choice.model) === current)?.provider ?? null),
  );
  const hereTab = $derived(
    tabs.find((tab) => tab.kind === 'provider' && currentProvider !== null && tab.providers.includes(currentProvider))?.key ?? null,
  );
  const firstTab = $derived.by(() => {
    if (current !== null && leadSections.some((led) => led.section.keys.includes(current))) return LEAD_TAB;
    return hereTab ?? tabs[0]?.key ?? LEAD_TAB;
  });
  const shownTab = $derived(tabs.find((tab) => tab.key === picked) ?? tabs.find((tab) => tab.key === firstTab) ?? tabs[0] ?? null);
  const railed = $derived(tabs.length > 1);

  const row = (choice: ModelChoice, marked: boolean, named: boolean): Row => ({
    kind: 'row',
    key: choiceKey(choice.provider, choice.model),
    choice,
    marked,
    named,
  });

  const lines = $derived.by<readonly Line[]>(() => {
    if (typed)
      return rankChoices(
        choices,
        query,
        lead.flatMap((section) => section.keys),
      ).map((choice) => row(choice, true, true));
    const tab = shownTab;
    const out: Line[] = [];
    if (tab === null || tab.kind === 'lead') {
      const labels = new Map<string, number>();
      for (const { choices: led } of leadSections) for (const choice of led) labels.set(choice.label, (labels.get(choice.label) ?? 0) + 1);
      for (const { section, choices: led } of leadSections) {
        const rows = led.map((choice) => row(choice, true, (labels.get(choice.label) ?? 0) > 1));
        out.push({
          kind: 'lead',
          key: `lead:${section.id}`,
          label: section.label,
          starred: section.starred === true,
          note: section.note ?? null,
        });
        if (section.starred === true && onreorder !== undefined) out.push({ kind: 'sortable', key: `sortable:${section.id}`, rows });
        else out.push(...rows);
      }
      if (tab !== null) return out;
    }
    const providers = tab === null ? [...new Set(choices.map((choice) => choice.provider))] : tab.kind === 'provider' ? tab.providers : [];
    for (const provider of providers) {
      const rows = choices.filter((choice) => choice.provider === provider).map((choice) => row(choice, false, false));
      if (rows.length === 0) continue;
      out.push({ kind: 'provider', key: `provider:${provider}`, provider, label: rows[0]!.choice.providerLabel }, ...rows);
    }
    return out;
  });

  const rows = $derived(lines.flatMap((line) => (line.kind === 'row' ? [line] : line.kind === 'sortable' ? line.rows : [])));
  const live = $derived(rows.filter((line) => line.choice.disabled !== true));
  const reorder = new Reorder(
    () => lines.flatMap((line) => (line.kind === 'sortable' ? line.rows.map((one) => one.key) : [])),
    (key, before) => {
      const moved = choiceAt(key);
      if (moved !== null) onreorder?.(moved, before === null ? null : choiceAt(before));
    },
    'y',
  );

  function choiceAt(key: string): ModelChoice | null {
    return rows.find((line) => line.key === key)?.choice ?? null;
  }
  const active = $derived.by<Row | null>(() => {
    const at = (key: string | null) => (key === null ? undefined : live.find((line) => line.key === key));
    return at(cursor) ?? (typed ? undefined : at(current)) ?? live[0] ?? null;
  });

  function rungOf(line: Row): string | null {
    return rungs[line.key] ?? line.choice.rung;
  }

  function step(line: Row, by: number): void {
    const ladder = line.choice.ladder;
    if (ladder.length === 0) return;
    const at = ladder.findIndex((one) => one.id === rungOf(line));
    const next = at < 0 ? (by > 0 ? 0 : ladder.length - 1) : Math.max(0, Math.min(ladder.length - 1, at + by));
    rungs[line.key] = ladder[next]!.id;
  }

  function valueOf(line: Row, toggle: ModelToggle): string | null {
    return flips[line.key]?.[toggle.id] ?? toggle.value;
  }

  function flip(line: Row, toggle: ModelToggle): void {
    if (busy) return;
    const next = valueOf(line, toggle) === toggle.on ? toggle.off : toggle.on;
    if (line.key === current && onswitch !== undefined) onswitch(line.choice, toggle.id, next);
    else flips[line.key] = { ...flips[line.key], [toggle.id]: next };
  }

  function reveal(box: HTMLElement | undefined): void {
    const item = box?.querySelector('[aria-selected="true"]');
    if (box === undefined || !item) return;
    const outer = box.getBoundingClientRect();
    const inner = item.getBoundingClientRect();
    if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
    else if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top;
  }

  function settle(): void {
    void tick().then(() => {
      if (list !== undefined) list.scrollTop = 0;
      reveal(list);
    });
  }

  function move(by: number): void {
    if (live.length === 0) return;
    const at = active === null ? -1 : live.indexOf(active);
    cursor = live[(at + by + live.length) % live.length]!.key;
    void tick().then(() => reveal(list));
  }

  function pick(line: Row, gesture: ModelGesture, rung: string | null = rungOf(line)): void {
    if (busy || line.choice.disabled === true) return;
    onpick(line.choice, rung, gesture, flips[line.key] ?? {});
  }

  function open(tab: Tab): void {
    picked = tab.key;
    query = '';
    cursor = null;
    settle();
  }

  function press(event: KeyboardEvent): void {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (active === null || active.choice.ladder.length === 0) return;
        event.preventDefault();
        step(active, event.key === 'ArrowRight' ? 1 : -1);
        return;
      case 'Enter':
        if (active === null) return;
        event.preventDefault();
        pick(active, queueAction !== null && (event.metaKey || event.ctrlKey) ? 'queue' : 'send');
        return;
      case 'Tab':
        if (event.shiftKey || active === null) return;
        event.preventDefault();
        pick(active, queueAction !== null ? 'queue' : 'send');
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (query !== '') {
          query = '';
          cursor = null;
          settle();
        } else onclose?.();
        return;
    }
  }

  onMount(() => {
    if (autofocus && !touch) search?.focus({ preventScroll: true });
    reveal(rail);
    reveal(list);
  });
</script>

{#snippet tabFace(tab: Tab)}
  {#if tab.kind === 'lead'}
    <Star class="size-4 fill-current" />
  {:else}
    <ProviderMark provider={tab.lead} class="size-4" titled={false} />
    <UsageGauge provider={tab.lead} row={accounts.signing(tab.lead)[0]} marked={false} />
  {/if}
{/snippet}

{#snippet choiceRow(line: Row)}
  {@const on = active?.key === line.key}
  {@const here = line.key === current}
  {@const rung = rungOf(line)}
  {@const off = line.choice.disabled === true}
  {@const ladder = line.choice.ladder}
  {@const reached = ladder.findIndex((one) => one.id === rung)}
  <div
    id={`${listId}-${line.key}`}
    role="option"
    tabindex="-1"
    aria-selected={on}
    aria-disabled={off}
    data-model-choice={line.key}
    class={[
      'group/choice flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-ui pointer-coarse:min-h-11',
      on && 'bg-selected text-foreground',
      off ? 'cursor-default opacity-45' : 'cursor-pointer',
    ]}
    onpointermove={() => {
      if (!off && reorder.carried === null && cursor !== line.key) cursor = line.key;
    }}
    onclick={() => pick(line, 'send')}
    onkeydown={press}
  >
    {#if here}
      <span class="size-1.5 shrink-0 bg-brand" aria-label="Current model"></span>
    {:else}
      <span class="w-1.5 shrink-0"></span>
    {/if}
    {#if line.marked}
      <ProviderMark provider={line.choice.provider} class="size-3.5 shrink-0 text-muted-foreground" titled={false} />
    {/if}
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <Tooltip text={line.choice.meta ? `${line.choice.meta} context` : null} class="flex min-w-0">
        <FadeText class="font-medium"><MatchText text={line.choice.label} {query} /></FadeText>
      </Tooltip>
      {#if line.named}
        <span class="shrink-0 text-small text-muted-foreground/70">{line.choice.providerLabel}</span>
      {/if}
      {#each line.choice.flags ?? [] as flag (flag.text)}
        <FadeText class={['min-w-0 shrink text-small', TONE[flag.tone]]} text={flag.text} />
      {/each}
    </span>
    {#if on && ladder.length > 0}
      <Rungs
        steps={ladder}
        model={line.choice.label}
        pressed={(step) => step === rung}
        disabled={busy}
        onpress={(step) => pick(line, 'send', step)}
        data-model-rung={rung ?? ''}
      />
    {:else if (here || rungs[line.key] !== undefined) && reached >= 0}
      <span class="shrink-0 px-1 text-small text-muted-foreground">{ladder[reached]!.label}</span>
    {/if}
    {#if on || here}
      {#each line.choice.toggles ?? [] as toggle (toggle.id)}
        {@const lit = valueOf(line, toggle) === toggle.on}
        <Tooltip text={`${toggle.label}\n${toggle.description}`}>
          <button
            type="button"
            tabindex="-1"
            class={[
              'grid size-5 shrink-0 place-items-center rounded-md transition-colors hover:bg-hover hover:text-foreground pointer-coarse:size-10',
              lit ? 'bg-hover text-foreground' : 'text-muted-foreground/70',
            ]}
            aria-label={toggle.label}
            aria-pressed={lit}
            disabled={busy}
            data-model-toggle={toggle.id}
            onclick={(event) => {
              event.stopPropagation();
              flip(line, toggle);
            }}
          >
            <InlineSvg svg={toggle.icon} class="size-3.5" />
          </button>
        </Tooltip>
      {/each}
    {/if}
    {#if onstar}
      {@const star = pinned.has(line.key)}
      <button
        type="button"
        tabindex="-1"
        class={[
          'grid size-5 shrink-0 place-items-center rounded-sm transition-opacity hover:bg-hover pointer-coarse:size-10',
          star ? 'text-foreground' : 'text-muted-foreground',
          on || star ? 'opacity-100' : 'opacity-0 group-hover/choice:opacity-100 pointer-coarse:opacity-100',
        ]}
        aria-label={star ? `Remove ${line.choice.label} from favorites` : `Add ${line.choice.label} to favorites`}
        aria-pressed={star}
        disabled={busy}
        onclick={(event) => {
          event.stopPropagation();
          onstar(line.choice.provider, line.choice.model);
        }}
      >
        <Star class={['size-3.5', star && 'fill-current']} />
      </button>
    {/if}
  </div>
{/snippet}

<div class={['@container grid min-w-0', railed && 'grid-cols-[auto_minmax(0,1fr)]']}>
  {#if railed}
    <div
      bind:this={rail}
      class={[
        'no-scrollbar grid h-0 min-h-full content-start justify-items-center gap-1 overflow-y-auto overscroll-contain border-r border-border p-1.5 transition-opacity',
        typed && 'opacity-45',
      ]}
      role="tablist"
      tabindex="-1"
      aria-label="Providers"
      aria-orientation="vertical"
      onpointerdown={(event) => event.preventDefault()}
      data-model-rail
    >
      {#each tabs as tab, index (tab.key)}
        {@const chosen = !typed && shownTab?.key === tab.key}
        <Tooltip text={tab.kind === 'lead' ? 'Favorites' : tab.label} side="right">
          <button
            type="button"
            role="tab"
            tabindex="-1"
            aria-selected={chosen}
            aria-label={tab.kind === 'lead' ? 'Favorites' : tab.label}
            class={[
              'relative grid h-10 w-9 place-content-center justify-items-center gap-1 rounded-md transition-colors hover:bg-hover',
              chosen ? 'bg-selected text-foreground' : 'text-foreground/85',
            ]}
            data-model-tab={tab.key}
            onclick={() => open(tab)}
          >
            {@render tabFace(tab)}
            {#if tab.key === hereTab}
              <span class="absolute top-1 right-1 size-1 bg-brand" aria-label="The current model is here"></span>
            {/if}
          </button>
        </Tooltip>
        {#if tab.kind === 'lead' && index < tabs.length - 1}
          <span class="h-px w-6 bg-border"></span>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="flex min-w-0 flex-col">
    <div class="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
      <Search class="size-3.5 shrink-0 text-muted-foreground" />
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={active === null ? undefined : `${listId}-${active.key}`}
        aria-label={title ?? 'Search models'}
        placeholder={title ?? 'Search models'}
        autocomplete="off"
        spellcheck="false"
        class="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-muted-foreground"
        oninput={() => {
          cursor = null;
          settle();
        }}
        onkeydown={press}
      />
      <span class="flex shrink-0 items-center gap-3 text-small text-muted-foreground/80 pointer-coarse:hidden">
        {#if hasLadder}
          <span class="flex items-center gap-1.5"
            ><span class="flex gap-0.5"><Kbd chord="←" size="sm" /><Kbd chord="→" size="sm" /></span>reasoning</span
          >
        {/if}
        {#if queueAction}
          <span class="flex items-center gap-1.5"><Kbd chord={spellKey('Tab', apple)} size="sm" />{queueAction}</span>
        {/if}
      </span>
    </div>

    <div
      bind:this={list}
      id={listId}
      role="listbox"
      aria-label="Models"
      tabindex="-1"
      class="relative h-80 overflow-y-auto overscroll-contain p-1 pointer-coarse:h-96"
      onpointerdown={(event) => event.preventDefault()}
      {@attach reorder.attach}
    >
      {#each lines as line (line.key)}
        {#if line.kind === 'lead'}
          <div class={HEADING}>
            {#if line.starred}<Star class="size-3 fill-current text-foreground" />{/if}
            {line.label}
            {#if line.note}<span class="ml-auto font-normal">{line.note}</span>{/if}
          </div>
        {:else if line.kind === 'provider'}
          <div class="grid min-w-0" data-model-provider={line.provider}>
            {#if heading}
              {@render heading(line.provider, line.label)}
            {:else}
              <div class={HEADING}>
                <ProviderMark provider={line.provider} class="size-3" titled={false} />
                {line.label}
              </div>
            {/if}
          </div>
        {:else if line.kind === 'sortable'}
          {#each reorder.arranged(line.rows, (one) => one.key) as one (one.key)}
            {@const carried = reorder.carried === one.key}
            <div
              class={['rounded-md', carried ? 'relative z-10 cursor-grabbing bg-popover shadow-raised' : 'transition-transform']}
              style:translate={reorder.offset(one.key)}
              data-reorder-item={one.key}
              data-reorder-handle={one.key}
              data-carried={carried || undefined}
              animate:glide
            >
              {@render choiceRow(one)}
            </div>
          {/each}
        {:else}
          {@render choiceRow(line)}
        {/if}
      {/each}
      {#if live.length === 0 && rows.length === 0}
        <div class="px-2 py-3 text-small text-muted-foreground" role="status">
          {choices.length === 0 && empty !== null ? empty : 'No model matches.'}
        </div>
      {/if}
    </div>

    {#if detail && active !== null}
      <div class="border-t border-border bg-hover px-3 py-2">
        <FadeText class="text-small text-muted-foreground">{@render detail(active.choice, rungOf(active))}</FadeText>
      </div>
    {/if}
  </div>
</div>
