<script lang="ts">
  import type {
    DebtRow,
    EnforcementReading,
    EngineRow,
    OwnerRow,
    RefusalPlace,
    UnitRow,
  } from '@tagma/server/enforcement/contract/wire/engines';
  import { type Snippet, untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { commitLink } from '$lib/features/checkout/links.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { currentProject } from '$lib/features/workspace/address.js';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import Debt from './Debt.svelte';
  import Figures from './Figures.svelte';
  import Findings from './Findings.svelte';
  import type { Found } from './found.js';
  import { RulesRepo } from './Repo.js';
  import Refusals from './Refusals.svelte';
  import StateLine from './StateLine.svelte';
  import StrictnessSwitch from './Strictness.svelte';
  import Tighten from './Tighten.svelte';
  import Trend from './Trend.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { fileLink } from '$lib/features/checkout/links.js';
  import type { Link } from '$lib/features/opening/Link.js';
  import { Asking } from '$lib/features/threads/Asking.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import { agoSaid } from '$lib/shared/time.js';
  import { useHere } from './here.js';
  import { askFix, type Choice, checkerKind, checkerName, placesSaid, plural, type Strictness, triggersSaid, unreadOf } from './words.js';

  let { name, updatedAt }: { name: string; updatedAt: string } = $props();

  type List = 'debt' | 'refusals' | 'escaped' | 'units';

  type Escape = NonNullable<EnforcementReading['escaped']>['rows'][number];

  type Trigger = EngineRow['on'][number];

  const repo = RulesRepo.use();
  const sessions = SessionRegistry.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const surface = App.current();

  const shaLink = (sha: string) => linkTarget(opening, () => commitLink({ sha, project: currentProject(router) }), surface);

  let focus = $state<string | null>(null);
  const entry = $derived(repo.engine.key({ rule: name, focus }));
  let kept = $state.raw<typeof entry.data>(undefined);
  const reading = $derived(entry.data ?? kept);
  const failed = $derived(entry.error);

  const first = repo.engine.key({ rule: untrack(() => name), focus: null });
  const cold = untrack(() => first.watch()) === undefined;
  let answer: Promise<boolean> | null = null;
  const settled = (): Promise<boolean> =>
    (answer ??= first.promise.then(
      () => true,
      () => true,
    ));

  $effect(() => {
    const data = entry.data;
    if (data !== undefined) kept = data;
  });

  let seen: string | null = null;
  $effect(() => {
    const at = updatedAt;
    if (seen === null || seen === at) {
      seen = at;
      return;
    }
    seen = at;
    untrack(
      () =>
        void repo.engine
          .key({ rule: name, focus })
          .refresh()
          .catch((error: unknown) => notices.refusal(error)),
    );
  });

  let moreDebt = $state<readonly DebtRow[]>([]);
  let moreOwners = $state<readonly OwnerRow[]>([]);
  let moreRefusals = $state<readonly RefusalPlace[]>([]);
  let moreEscaped = $state<readonly Escape[]>([]);
  let moreUnits = $state<readonly UnitRow[]>([]);
  let next = $state<Readonly<Record<List, string | null>>>({ debt: null, refusals: null, escaped: null, units: null });

  $effect(() => {
    next = {
      debt: reading?.debt?.next ?? null,
      refusals: reading?.refusals?.next ?? null,
      escaped: reading?.escaped?.next ?? null,
      units: reading?.units?.next ?? null,
    };
    moreDebt = [];
    moreOwners = [];
    moreRefusals = [];
    moreEscaped = [];
    moreUnits = [];
  });

  async function more(list: List): Promise<void> {
    const cursor = next[list];
    if (cursor === null) return;
    try {
      const page = await repo.more.key({ rule: name, cursor }).refresh({ throwOnError: true });
      if (list === 'debt') {
        moreDebt = [...moreDebt, ...(page?.debt?.rows ?? [])];
        moreOwners = [...moreOwners, ...(page?.owners ?? [])];
      } else if (list === 'refusals') moreRefusals = [...moreRefusals, ...(page?.refusals?.rows ?? [])];
      else if (list === 'escaped') moreEscaped = [...moreEscaped, ...(page?.escaped?.rows ?? [])];
      else moreUnits = [...moreUnits, ...(page?.units?.rows ?? [])];
      next = { ...next, [list]: page?.[list]?.next ?? null };
    } catch (error) {
      notices.refusal(error);
    }
  }

  const moreOf = (list: List): (() => void) | null => (next[list] === null ? null : () => void more(list));

  const owners = $derived.by(() => {
    const known = new Map((reading?.engine?.owners ?? []).map((one) => [one.name, one]));
    for (const one of moreOwners) if (!known.has(one.name)) known.set(one.name, one);
    return [...known.values()];
  });

  type Slipped = Found & { readonly escape: Escape };

  const escaped = $derived(
    [...(reading?.escaped?.rows ?? []), ...moreEscaped].map((escape): Slipped => ({
      key: escape.fingerprint,
      at: null,
      file: escape.path,
      line: escape.line ?? null,
      said: escape.said ?? null,
      fix: escape.fix ?? null,
      times: 1,
      escape,
    })),
  );

  const refusals = $derived([...(reading?.refusals?.rows ?? []), ...moreRefusals]);

  const general = $derived(reading?.engine?.generalFix ?? null);

  const now = Date.now();

  const ceiling = $derived.by(() => {
    const figure = reading?.engine?.figures.find((one) => one.kind === 'thresholds');
    return figure?.kind === 'thresholds' ? (figure.thresholds[0]?.lines ?? null) : null;
  });

  const duration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

  const asking = Asking.use();
  const blocks = BlocksRepo.use();
  const tags = TagCatalog.use();
  const here = useHere();

  let deciding = $state(false);
  let target = $state<Strictness | null>(null);
  let busy = $state(false);

  const LANDING = { op: 'submit_work', phase: 'before' } as const;

  const triggersFor = (strictness: Strictness, row: EngineRow): readonly Trigger[] | undefined =>
    strictness === 'note' || strictness === row.strictness || row.on.some((one) => one.phase === 'before')
      ? undefined
      : [...row.on, LANDING];

  async function enforce(strictness: Strictness, extra: { absorb?: 'all'; owner?: string } = {}): Promise<boolean> {
    const engine = reading?.engine;
    if (engine === undefined) return false;
    busy = true;
    try {
      await repo.enforce.run(
        { blockId: name, base: engine.revision, strictness, on: triggersFor(strictness, engine.row), ...extra },
        { throwOnError: true },
      );
      await entry.refresh();
      return true;
    } catch (error) {
      notices.refusal(error);
      return false;
    } finally {
      busy = false;
    }
  }

  const fileAt = (path: string, line: number | null): Link => fileLink({ path, line: line ?? undefined, root: here.root() });

  function pick(strictness: Strictness): void {
    if (strictness === 'gate' && (reading?.engine?.row.escaped ?? 0) > 0) {
      target = 'gate';
      deciding = true;
      return;
    }
    void enforce(strictness);
  }

  function keepKnown(): void {
    target = reading?.engine?.row.strictness ?? null;
    deciding = true;
  }

  function askToFix(count: number): void {
    const place = here.ask();
    if (place !== null) void asking.draft(place, askFix(name, count));
  }

  async function decide(choice: Choice): Promise<void> {
    const row = reading?.engine?.row;
    if (row === undefined || target === null) return;
    if (choice === 'fix') {
      deciding = false;
      askToFix(row.escaped);
      return;
    }
    if (choice === 'leave') {
      deciding = false;
      await enforce(target);
      return;
    }
    const work = tags.workTag;
    if (work === null) return;
    busy = true;
    let task: { readonly name: string } | undefined;
    try {
      task = await blocks.create.run(
        { parentId: name, tags: [work], title: `Remove the ${plural(row.escaped, 'violation')} that slipped past this rule` },
        { throwOnError: true },
      );
    } catch (error) {
      notices.refusal(error);
    } finally {
      busy = false;
    }
    if (task === undefined) return;
    if (await enforce(target, { absorb: 'all', owner: task.name })) deciding = false;
    else await blocks.trash.run(task.name).catch((error: unknown) => notices.refusal(error));
  }
</script>

{#snippet part(heading: string, count: string | number, aside: Snippet | null = null, tone = 'text-muted-foreground')}
  <div class="mt-8 mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <h3 class="text-ui font-medium text-foreground">{heading}</h3>
    <span class={cn('text-small tabular-nums', tone)}>{count}</span>
    {#if aside}{@render aside()}{/if}
  </div>
{/snippet}

{#snippet stays()}
  <span class="text-small text-muted-foreground">landed while the rule did not block; each stays until it is removed</span>
{/snippet}

{#if !cold || (await settled())}
  {#if failed && !reading}
    {@const unread = unreadOf("rule's engine", failed)}
    <StateLine title={unread.title} class="mt-6">{unread.detail}</StateLine>
  {:else if reading?.engine}
    {@const engine = reading.engine}
    {@const row = engine.row}
    {@const slipped = reading.escaped?.total ?? row.escaped}
    {@const known = reading.debt?.total ?? row.debt.count}
    {@const blocked = reading.refusals?.total ?? 0}
    <section class="mt-8 border-t border-vein pt-5">
      <StrictnessSwitch current={row.strictness} {busy} onpick={pick} />

      {#if row.unreadable}
        <StateLine title="This server cannot read the rule's enforcement." class="mt-6" />
      {:else if row.checker?.kind === 'unread'}
        <StateLine title="The check cannot run." class="mt-6">{` ${row.checker.reason}`}</StateLine>
      {:else if slipped === 0 && known === 0}
        <p class="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
          {#if row.measured}
            <span class="size-1.5 rounded-full bg-status-verified"></span>No violations in the code
            <Trend history={engine.history} was={row.debt.was} total={known} />
          {:else}
            Not measured in this checkout yet
          {/if}
        </p>
      {/if}

      {#if slipped > 0}
        {@render part('Slipped through', slipped, stays, 'text-severity-gap')}
        <Findings rows={escaped} total={slipped} more={moreOf('escaped')} {now} {general} link={fileAt}>
          {#snippet detail({ escape })}
            <p>
              {escape.changed === 'check' ? 'Stood at' : 'Landed in'}
              <a
                class="font-mono text-foreground/80 hover:text-foreground"
                href={addresses.commit(escape.commit)}
                {@attach shaLink(escape.commit)}>{escape.commit.slice(0, 8)}</a
              >{#if escape.changed === 'check'}{' when the check changed'}{/if}{#if escape.holder !== undefined}, held by {escape.holder}{/if}.
            </p>
          {/snippet}
        </Findings>
        <div class="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onclick={() => askToFix(slipped)}>Ask an agent to fix</Button>
          {#if tags.workTag !== null}<Button size="sm" variant="ghost" disabled={busy} onclick={keepKnown}>Keep as known…</Button>{/if}
        </div>
      {/if}

      {#if known > 0}
        {#snippet trend()}<Trend history={engine.history} was={row.debt.was} total={known} />{/snippet}
        {@render part('Known violations', known, trend)}
        <Debt
          rows={[...(reading.debt?.rows ?? []), ...moreDebt]}
          total={known}
          {owners}
          {ceiling}
          {general}
          more={moreOf('debt')}
          {now}
          link={fileAt}
        />
      {/if}

      {#if blocked > 0}
        {@render part(
          'Commits blocked',
          reading.refusals === undefined || reading.refusals.times === blocked
            ? blocked
            : `${reading.refusals.times} times at ${plural(blocked, 'place')}`,
        )}
        <Refusals rows={refusals} total={blocked} more={moreOf('refusals')} {now} {general} link={fileAt} />
      {/if}

      <Disclosure class="mt-8 border-t border-vein pt-3" summaryClass="w-full min-w-0 gap-2 text-ui">
        {#snippet summary()}
          <span class="shrink-0 text-foreground/90">What it checks</span>
          <FadeText class="min-w-0 text-muted-foreground" title={placesSaid(row.places)} text={placesSaid(row.places)} />
        {/snippet}
        <div class="mt-4 grid gap-5 pl-5">
          {#if engine.figures.length > 0}
            <Figures
              figures={engine.figures}
              units={[...(reading.units?.rows ?? []), ...moreUnits]}
              unitsTotal={reading.units?.total ?? 0}
              more={moreOf('units')}
              onfocus={(module) => (focus = module)}
            />
          {/if}
          <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
            <dt class="text-muted-foreground">Checked by</dt>
            <dd class="text-foreground/85">
              {#if row.checker === null}text{:else if row.checker.kind === 'builtin'}Tagma's {checkerName(row.checker)} check{:else}{checkerKind(
                  row.checker,
                )}
                {checkerName(row.checker)}{/if}
            </dd>
            {#if row.inspection !== null}
              <dt class="text-muted-foreground">Key</dt>
              <dd class="font-mono text-small break-all text-foreground/85">
                {`${row.inspection}${row.function === null ? '' : ` · ${row.function}`} · tagma.config.ts`}
              </dd>
            {/if}
            <dt class="text-muted-foreground">Runs</dt>
            <dd class="text-foreground/85">{triggersSaid(row.on)}</dd>
            <dt class="text-muted-foreground">Measured</dt>
            <dd class="text-foreground/85">
              {#if row.measured}
                {duration(row.measured.ms)} for a full reading, at
                <a
                  class="font-mono text-small hover:text-foreground"
                  href={addresses.commit(row.measured.commit)}
                  {@attach shaLink(row.measured.commit)}>{row.measured.commit.slice(0, 8)}</a
                >
                {agoSaid(row.measured.at)}
              {:else}
                not in this checkout yet
              {/if}
            </dd>
            {#if engine.changed}
              <dt class="text-muted-foreground">{engine.changed.act === 'remeasure' ? 'Re-measured' : 'Changed'}</dt>
              <dd class="flex flex-wrap items-center gap-1.5 text-foreground/85">
                {agoSaid(engine.changed.at)}
                {#if engine.changed.session !== null}<WriterBadge writer={sessions.writerOf(engine.changed.session)} />{/if}
              </dd>
            {/if}
          </dl>
          {#if engine.historyEnds}
            <p class="text-small text-severity-gap">History stops early: {engine.historyEnds}.</p>
          {/if}
        </div>
      </Disclosure>
    </section>
    <Tighten
      bind:open={deciding}
      count={slipped}
      blocking={target === 'gate' && row.strictness !== 'gate'}
      canKeep={tags.workTag !== null}
      {busy}
      ondecide={(choice) => void decide(choice)}
    />
  {/if}
{/if}
