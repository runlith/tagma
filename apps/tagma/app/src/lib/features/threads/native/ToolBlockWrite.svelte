<script lang="ts">
  import type { BlockAnswer, GraphCopy } from '@tagma/server/graph/contract/wire/answers';
  import type { CallJournalRange } from '@tagma/server/graph/contract/wire/callRange';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import Well from '@runlith/chat-ui/entries/Well.svelte';
  import { diffParam } from '$lib/features/workspace/address.js';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import DiffBox from '$lib/features/graph/DiffBox.svelte';
  import { placedAim } from '$lib/features/graph/blockRefView.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { linkTarget, linkWithin } from '$lib/features/opening/linkTarget.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import BlockCard from '../BlockCard.svelte';

  let { id, block, range, place }: { id: string; block: BlockAnswer; range: CallJournalRange; place?: GraphCopy } = $props();

  const blocks = BlocksRepo.use();
  const titles = BlockTitles.use();
  const workspace = Workspace.use();
  const opening = Opening.use();
  const here = App.current();
  const subject = $derived(range.subject);
  const name = $derived(block.identity ?? block.name);
  const origin = $derived.by(() => {
    const copy = subject?.copy ?? place;
    if (copy !== undefined) {
      const aimed = placedAim(copy, workspace.find(copy.projectId));
      if (aimed !== null || subject !== undefined) return aimed;
    }
    const peer = titles.peer(name);
    if (peer == null || 'error' in peer) return null;
    const project = workspace.named(peer.project);
    return project === null ? null : { projectId: project.id, branch: peer.branch ?? null };
  });
  const there = $derived(origin === null ? null : { project: String(origin.projectId), branch: origin.branch ?? undefined });
  const lens = $derived(
    there === null ? undefined : blocks.diff.key({ name: subject?.name ?? name, from: range.from, to: range.to, lens: there }).data,
  );
  const diff = $derived(lens !== undefined && !lens.diff.ops.includes('create') ? diffParam(range) : undefined);
  const history = $derived(subject === undefined || origin === null ? null : { name: subject.name, copy: origin, diff: diffParam(range) });
  const historyHref = $derived(subject === undefined ? null : titles.placed(subject.name, subject.copy, diffParam(range)));
  const related = (element: HTMLElement) => {
    const name = element.dataset['block'];
    return name === undefined || origin === null ? null : blockLink({ name, copy: origin });
  };
</script>

<div class="grid min-w-0 gap-1.5">
  <Well {id} copy={null} rows>
    <BlockCard {block} diff={subject === undefined ? diff : undefined} {place} />
    {#if history !== null}
      <a
        href={historyHref ?? undefined}
        role={historyHref == null ? 'link' : undefined}
        tabindex={historyHref == null ? 0 : undefined}
        {@attach linkTarget(opening, () => (history === null ? null : blockLink(history)), here)}
        class="inline-flex px-1.5 text-small text-muted-foreground hover:text-foreground">View departure</a
      >
    {/if}
  </Well>
  {#if lens && origin}
    <div {@attach linkWithin(opening, 'a[data-block]', related, here)}>
      <DiffBox class="rounded-lg bg-sunken">
        <BlockDiffCard diff={lens.diff} marks={lens.marks} blocks={lens.blocks} there={origin} />
      </DiffBox>
    </div>
  {/if}
</div>
