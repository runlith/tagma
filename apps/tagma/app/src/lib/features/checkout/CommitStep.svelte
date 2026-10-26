<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { SubmitReceipt } from '@tagma/server/landing/contract/wire/receipt';
  import { type ComparedPath, holderAt } from '@tagma/server/workspace/contract/wire/checkout';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Beside } from '$lib/features/opening/Beside.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { insetOf } from './changeItem.js';
  import CommitFiles from './CommitFiles.svelte';
  import { counted } from './holdingWords.js';
  import { changeLink } from './links.js';
  import { changesPane } from './paneContent.js';
  import { holderName } from '$lib/features/worktrees/holders.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  let { entry, checkout, commit }: { entry: ChatEntryOf<'tool'>; checkout: RootId; commit: string } = $props();

  type Landed = Extract<SubmitReceipt, { readonly status: 'landed' }>;

  const changes = ThreadChanges.use();
  const beside = Beside.use();
  const names = ThreadNames.use();
  const opening = Opening.use();
  const app = App.current();

  const link = (file: ComparedPath) =>
    linkTarget(opening, () => changeLink({ projectId, rootId: checkout, path: file.path, commit }, { thread: changes.threadId }), app);

  const receipt = $derived.by((): Landed | null => {
    const submitted = (entry.toolOutput as { readonly submitted?: SubmitReceipt } | null | undefined)?.submitted;
    return submitted?.status === 'landed' ? submitted : null;
  });
  const formatted = $derived(new Set(receipt?.edited ?? []));
  const carried = $derived(new Map((receipt?.carried ?? []).map((one) => [one.path, one.holders])));
  const left = $derived(receipt?.left ?? []);
  const projectId = $derived(changes.projectOf(checkout));
  const selected = $derived(
    changes.open !== null && changes.open.commit === commit && changes.open.rootId === checkout ? changes.open.path : null,
  );

  const label = (thread: string): string | null => names.of(thread)?.label ?? null;

  function showLeft(): void {
    changes.open = null;
    changes.lens = 'now';
    beside.show({ content: changesPane, from: { thread: changes.threadId } });
  }
</script>

<div class="grid min-w-0 gap-1" data-commit-step={commit}>
  <CommitFiles {projectId} rootId={checkout} {commit} grouped={false} {selected} heading={false} depth={0} gitLink {link}>
    {#snippet aside(file: ComparedPath)}
      {@const holders = carried.get(file.path) ?? []}
      {#if formatted.has(file.path)}<span class="shrink-0 text-small text-muted-foreground/70">formatted</span>{/if}
      {#if holders.length > 0}
        <span class="shrink-0 text-small text-muted-foreground/70"
          >with {holders.map((holder) => holderName(holderAt(holder), label)).join(', ')}</span
        >
      {/if}
    {/snippet}
  </CommitFiles>
  {#if left.length > 0}
    <button
      type="button"
      class="flex h-6 w-fit items-center gap-3 rounded-md pr-1.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      style:padding-left="{insetOf(0)}px"
      onclick={showLeft}
      data-commit-left={left.length}
    >
      Left uncommitted
      <span class="flex items-center gap-0.5 text-status-in-work"
        >{counted(left.length, 'file', 'files')}<ChevronRight class="size-3" /></span
      >
    </button>
  {/if}
</div>
