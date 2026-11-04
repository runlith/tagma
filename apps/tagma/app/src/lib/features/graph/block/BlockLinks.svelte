<script lang="ts" module>
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';

  const referrersOf = (read: BlockRead, store: TreeScreen): readonly string[] => {
    const outlined = new Set(store.visibleChildren(read.identity));
    return read.refsInDetails.filter((ref) => ref.identity !== read.identity && !outlined.has(ref.identity)).map((ref) => ref.identity);
  };

  export function hasLinks(read: BlockRead, store: TreeScreen): boolean {
    return (
      read.edgesOut.length > 0 ||
      read.edgesIn.length > 0 ||
      (read.edgesInUnread?.length ?? 0) > 0 ||
      read.refsOutDetails.length > 0 ||
      (read.refsAbsent?.length ?? 0) > 0 ||
      referrersOf(read, store).length > 0 ||
      read.restingIn.edges.length > 0 ||
      read.restingIn.refsDetails.some((ref) => ref.identity !== read.identity)
    );
  }
</script>

<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Unlink from '@lucide/svelte/icons/unlink';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { EdgeKind } from '@tagma/server/graph/contract/wire/edges';
  import type { FarEnd } from '@tagma/server/graph/contract/wire/far';
  import FadeText from '$lib/shared/FadeText.svelte';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { read, store, beside, unlinked }: { read: BlockRead; store: TreeScreen; beside: boolean; unlinked: () => void } = $props();

  const blocks = BlocksRepo.use();
  const notices = Notices.use();
  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  const OUT_LABEL: Partial<Record<EdgeKind, string>> = {
    implements: 'Implements',
    'waits-on': 'Waits for',
    'discovered-from': 'Discovered from',
    supersedes: 'Supersedes',
    validates: 'Validates',
    relates: 'Related',
  };
  const IN_LABEL: Partial<Record<EdgeKind, string>> = {
    implements: 'Implemented by',
    'waits-on': 'Blocks',
    'discovered-from': 'Led to',
    supersedes: 'Superseded by',
    validates: 'Validated by',
    relates: 'Related',
  };

  type LinkItem = {
    readonly name: string;
    readonly far?: FarEnd;
    readonly branch?: string | null;
    readonly held?: { readonly kind: EdgeKind };
  };
  type LinkGroup = { key: string; label: string; items: readonly LinkItem[] };

  const NOT_HERE: FarEnd = { project: '', projectId: null, state: 'absent', title: null, reason: 'Not on this machine' };

  const grouped = (entries: readonly (readonly [key: string, label: string, item: LinkItem])[], prefix = ''): LinkGroup[] => {
    const groups = new Map<string, Omit<LinkGroup, 'key'>>();
    for (const [key, label, item] of entries) {
      const group = groups.get(key);
      if (!group) groups.set(key, { label, items: [item] });
      else if (!group.items.some((known) => known.name === item.name)) group.items = [...group.items, item];
    }
    return [...groups].map(([key, group]) => ({ key: `${prefix}${key}`, ...group }));
  };

  const linkGroups = $derived(
    grouped([
      ...read.edgesOut.map((edge) => {
        const label = OUT_LABEL[edge.kind];
        const held = edge.graph !== undefined && edge.graph.state !== 'here' && edge.kind === 'waits-on' ? { kind: edge.kind } : undefined;
        return [
          label === undefined || edge.kind === 'relates' ? `edge:${edge.kind}` : `edge:out:${edge.kind}`,
          label ?? edge.kind,
          { name: edge.toIdentity ?? edge.toName, far: edge.graph, held },
        ] as const;
      }),
      ...read.edgesIn.map((edge) => {
        const label = IN_LABEL[edge.kind];
        return [
          label === undefined || edge.kind === 'relates' ? `edge:${edge.kind}` : `edge:in:${edge.kind}`,
          label ?? edge.kind,
          { name: edge.fromIdentity ?? edge.fromName, far: edge.graph },
        ] as const;
      }),
    ]),
  );

  const referenceGroups = $derived.by(() => {
    const groups: LinkGroup[] = [];
    const elsewhere = new Map((read.refsElsewhere ?? []).map((ref) => [ref.identity, ref] as const));
    const out: LinkItem[] = [
      ...read.refsOutDetails.map((ref): LinkItem => {
        const name = ref.identity;
        const there = elsewhere.get(name);
        return there === undefined
          ? { name }
          : {
              name,
              far: { project: there.project, projectId: there.projectId, state: 'here', title: null, reason: null },
              branch: there.branch,
            };
      }),
      ...(read.refsAbsent ?? []).map((name): LinkItem => ({ name, far: NOT_HERE })),
    ];
    const incoming = referrersOf(read, store);
    if (out.length > 0) groups.push({ key: 'ref:out', label: 'References', items: out });
    if (incoming.length > 0) groups.push({ key: 'ref:in', label: 'Referenced by', items: incoming.map((name) => ({ name })) });
    return groups;
  });

  const allLinkGroups = $derived([...linkGroups, ...referenceGroups]);
  const unread = $derived(read.edgesInUnread ?? []);

  const restingGroups = $derived(
    grouped(
      [
        ...read.restingIn.edges.map((edge) => {
          const label = IN_LABEL[edge.kind] ?? edge.kind;
          return [label, label, { name: edge.fromIdentity ?? edge.fromName, far: edge.graph }] as const;
        }),
        ...read.restingIn.refsDetails
          .filter((ref) => ref.identity !== read.identity)
          .map((ref) => ['Referenced by', 'Referenced by', { name: ref.identity }] as const),
      ],
      'resting:',
    ),
  );
  const restingCount = $derived(new Set(restingGroups.flatMap((group) => group.items.map((item) => item.name))).size);

  const unlinking = $derived(blocks.unlink.pending);

  async function unlink(item: LinkItem): Promise<void> {
    if (item.held === undefined) return;
    try {
      await blocks.unlink.run({ from: read.identity, kind: item.held.kind, to: item.name }, { throwOnError: true });
      unlinked();
    } catch (error) {
      notices.refusal(error);
    }
  }

  let restingOpen = $state(false);

  $effect(() => {
    void read.identity;
    restingOpen = false;
  });
</script>

{#snippet linkRows(items: readonly LinkItem[], quiet: boolean)}
  <div class={cn('mt-1 grid gap-x-8 gap-y-0.5 sm:grid-cols-2', beside && '@rail/page:grid-cols-1')}>
    {#each items as item (item.name)}
      {@const far = item.far}
      {#if far !== undefined && far.state !== 'here'}
        <div class="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground/70">
          <span class="size-1.5 shrink-0 rounded-full border border-muted-foreground/50"></span>
          <Tooltip text={far.reason ?? 'Not on this machine'} class="block min-w-0 flex-1">
            <FadeText text={far.project === '' ? 'Not on this machine' : `${far.project} · not on this machine`} />
          </Tooltip>
          {#if item.held !== undefined}
            <Tooltip text="Unlink this edge in this graph; colleagues see it in git">
              <button
                type="button"
                class="grid size-5 shrink-0 place-items-center rounded-sm transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                aria-label="Unlink"
                disabled={unlinking}
                onclick={() => void unlink(item)}
              >
                <Unlink class="size-3" />
              </button>
            </Tooltip>
          {/if}
          <span class="w-12 shrink-0"><BlockName name={item.name} /></span>
        </div>
      {:else}
        {@const peer = far === undefined ? store.block(item.name) : undefined}
        {@const title = far === undefined ? peer?.title.trim() : far.title?.trim()}
        <a
          href={far === undefined
            ? addresses.block(item.name)
            : addresses.block(item.name, { project: far.project, branch: item.branch ?? null })}
          data-block={item.name}
          data-project={far?.projectId ?? undefined}
          data-branch={far === undefined ? undefined : (item.branch ?? undefined)}
          class={cn(
            'group/link -mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui transition-colors hover:bg-hover',
            quiet && 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span class="size-1.5 shrink-0 rounded-full" style:background={peer ? tags.statusVar(peer) : 'var(--muted-foreground)'}></span>
          <span data-line class="flex-1 items-center gap-1.5">
            <FadeText class={cn(!title && 'text-muted-foreground')} text={title || item.name} />
            {#if far !== undefined}
              <FadeText data-yield class="stamp text-muted-foreground" text={far.project} />
            {/if}
          </span>
        </a>
      {/if}
    {/each}
  </div>
{/snippet}

{#if allLinkGroups.length > 0 || restingCount > 0 || unread.length > 0}
  <section>
    <h2 class="eyebrow text-muted-foreground">Links</h2>
    <div class="mt-2 grid gap-4">
      {#if unread.length > 0}
        <Tooltip text="Their graphs are still opening on this machine; edges from them show once they are read" class="block min-w-0">
          <div class="text-small text-muted-foreground/70">
            <FadeText text={`Edges from ${unread.join(', ')} not read yet`} />
          </div>
        </Tooltip>
      {/if}
      {#each allLinkGroups as group (group.key)}
        <div>
          <div class="text-small text-muted-foreground/80">{group.label}</div>
          {@render linkRows(group.items, false)}
        </div>
      {/each}

      {#if restingCount > 0}
        <div class={cn(allLinkGroups.length > 0 && 'border-t border-vein pt-3')}>
          <button
            type="button"
            class="group/rest -mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-small text-muted-foreground/80 transition-colors hover:bg-hover hover:text-foreground"
            aria-expanded={restingOpen}
            onclick={() => (restingOpen = !restingOpen)}
          >
            <ChevronRight class={cn('size-3 transition-transform duration-150', restingOpen && 'rotate-90')} />
            <span>From finished or replaced work</span>
            <span class="stamp tabular text-muted-foreground/60">{restingCount}</span>
          </button>
          {#if restingOpen}
            <div class="mt-2 grid gap-3 pl-4">
              {#each restingGroups as group (group.key)}
                <div>
                  <div class="text-small text-muted-foreground/70">{group.label}</div>
                  {@render linkRows(group.items, true)}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>
{/if}
