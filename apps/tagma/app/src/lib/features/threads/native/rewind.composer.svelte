<script lang="ts">
  import { ThreadsRepo } from '../Repo.js';
  import { ThreadList } from '../List.svelte.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ThreadDraft } from '../Draft.svelte.js';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { RenderingPorts } from './RenderingPorts.svelte.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import RewindConfirm from './RewindConfirm.svelte';
  import { RewindOps } from './RewindOps.js';
  import { Rewinds } from './Rewinds.svelte.js';
  import RunEnding from './RunEnding.svelte';

  let {
    shown,
    chat,
    draft,
    views,
    writes,
    panel,
    composer,
    rendering,
    contributor,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    draft: ThreadDraft;
    views: ThreadViews;
    writes: ThreadWrites;
    panel: ModelPanelState;
    composer: ComposerContributions;
    rendering: RenderingPorts;
    contributor: string;
  } = $props();

  const repo = ThreadsRepo.use();
  const list = ThreadList.use();
  const rewinds = $derived(new Rewinds(shown, chat, draft, writes, new RewindOps(repo, shown.projectId), list.births));

  $effect(() => {
    const standing = rewinds;
    return () => standing.dispose();
  });

  $effect(() => rewinds.watch());

  $effect.pre(() => (rewinds.offered ? rendering.contributeRewind(contributor, rewinds) : undefined));

  $effect.pre(() => composer.chip(contributor, { id: 'run-ending', region: 'dock', body: runEnding }));
</script>

{#snippet runEnding()}
  <RunEnding {shown} {chat} {views} {writes} {panel} {rewinds} />
{/snippet}

<RewindConfirm {rewinds} />
