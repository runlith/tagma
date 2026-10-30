<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import Strip from './Strip.svelte';

  let {
    shown,
    birth,
    places,
    composer,
    contributor,
  }: { shown: ShownThread; birth: ThreadBirth; places: Worktrees; composer: ComposerContributions; contributor: string } = $props();

  $effect.pre(() => composer.chip(contributor, { id: 'place', region: 'strip', body: strip }));
</script>

{#snippet strip()}
  <Strip {shown} place={birth.place} {places} />
{/snippet}
