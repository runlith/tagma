<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import ComposerParts from '../../plugin-views/ComposerParts.svelte';
  import { PluginActions } from '../../plugin-views/PluginActions.svelte.js';
  import { ViewSets } from '../../plugin-views/ViewSets.svelte.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ThreadDraft } from '../Draft.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import { composerFace } from './composerFace.js';
  import type { SlotSurface } from './contribution.js';

  let {
    shown,
    chat,
    draft,
    writes,
    composer,
    surface,
    contributor,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    draft: ThreadDraft;
    writes: ThreadWrites;
    composer: ComposerContributions;
    surface: SlotSurface;
    contributor: string;
  } = $props();

  const sets = ViewSets.use();
  const actions = PluginActions.use();

  const face = $derived(composerFace(shown, draft.held(), draft, chat, writes, surface.prompt));

  $effect.pre(() => {
    const releases = actions.commands(shown.projectId, face).map((command) => composer.command(contributor, command));
    return () => {
      for (const release of releases) release();
    };
  });

  $effect.pre(() =>
    sets.composerParts.length === 0 ? undefined : composer.chip(contributor, { id: 'plugins', region: 'dock', body: drawn }),
  );
</script>

{#snippet drawn()}
  <ComposerParts projectId={shown.projectId} threadId={shown.id} {face} />
{/snippet}
