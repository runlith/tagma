<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { EngineRow } from '@tagma/server/enforcement/contract/wire/engines';
  import { GraphFeed } from '$lib/features/graph/Feed.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import PageHeader from '$lib/shared/PageHeader.svelte';
  import { RulesRepo } from './Repo.js';
  import RuleRow from './RuleRow.svelte';
  import RulesStart from './RulesStart.svelte';
  import StateLine from './StateLine.svelte';
  import { headingOf, unreadOf } from './words.js';

  const repo = RulesRepo.use();
  const feed = GraphFeed.use();
  const catalog = TagCatalog.use();
  const notices = Notices.use();

  const reading = $derived(repo.rules.data);
  const failed = $derived(repo.rules.error);
  let extra = $state<readonly EngineRow[]>([]);
  let next = $state<string | null>(null);

  $effect(() => {
    next = reading?.rules?.next ?? null;
    extra = [];
  });

  $effect(() =>
    feed.frames((event) => {
      if (
        event.type === 'change' &&
        (event.events.some((entry) => entry.op === 'enforce' || entry.op === 'remeasure') ||
          [...event.blocks, ...event.trash].some((block) => catalog.bearsLaw(block)))
      ) {
        void repo.rules.refresh().catch((error: unknown) => notices.refusal(error));
      }
    }),
  );

  async function more(cursor: string): Promise<void> {
    try {
      const page = await repo.more.key({ rule: null, cursor }).refresh({ throwOnError: true });
      extra = [...extra, ...(page?.rules?.rows ?? [])];
      next = page?.rules?.next ?? null;
    } catch (error) {
      notices.refusal(error);
    }
  }

  const rows = $derived([...(reading?.rules?.rows ?? []), ...extra]);

  const groups = $derived.by(() => {
    const held = new Map<string, EngineRow[]>();
    for (const row of rows) {
      const heading = headingOf(row.checker);
      held.set(heading, [...(held.get(heading) ?? []), row]);
    }
    return [...held].map(([heading, members]) => ({ heading, rows: members }));
  });

  const now = Date.now();
</script>

<div class="page-wide pt-8 pb-16">
  {#if failed && !reading}
    {@const unread = unreadOf('rules', failed)}
    <StateLine title={unread.title}>{unread.detail}</StateLine>
  {:else if !reading}
    <div class="grid h-40 place-items-center">
      <Waiting class="size-4 text-muted-foreground" label="Reading the rules" />
    </div>
  {:else}
    {@const counts = reading.counts}
    {#if rows.length === 0 && (reading.rules?.total ?? 0) === 0}
      <RulesStart />
    {:else}
      <PageHeader title="Rules" class="mb-2 px-2" />
      {#if counts}
        <p class="mb-6 flex flex-wrap gap-x-4 gap-y-1 px-2 text-ui text-muted-foreground tabular-nums">
          <span><span class="text-foreground">{counts.rules}</span> {counts.rules === 1 ? 'rule' : 'rules'}</span>
          <span><span class="text-foreground">{counts.enforced}</span> checked on every commit</span>
          {#if counts.escaped > 0}<span class="text-severity-gap">{counts.escaped} slipped through</span>{/if}
          {#if counts.debt > 0}<span
              ><span class="text-foreground">{counts.debt}</span> known {counts.debt === 1 ? 'violation' : 'violations'}</span
            >{/if}
        </p>
      {/if}
    {/if}

    {#each groups as group (group.heading)}
      <section class="mb-6">
        <h2 class="eyebrow mb-1 px-2 text-muted-foreground">{group.heading}</h2>
        {#each group.rows as row (row.rule)}
          <RuleRow {row} {now} />
        {/each}
      </section>
    {/each}

    {#if next !== null}
      <button
        type="button"
        class="px-2 text-ui text-muted-foreground hover:text-foreground"
        onclick={() => next !== null && void more(next)}
      >
        Show more rules
      </button>
    {/if}
  {/if}
</div>
