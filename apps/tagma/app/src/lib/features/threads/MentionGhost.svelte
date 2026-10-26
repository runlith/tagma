<script lang="ts">
  import DragGhost from '$lib/shared/DragGhost.svelte';
  import { MentionDrops } from './MentionDrops.svelte.js';

  const drops = MentionDrops.use();
</script>

{#if drops.ghost !== null}
  <DragGhost x={drops.ghost.at.x} y={drops.ghost.at.y} label={drops.ghost.label} target={drops.ghost.aimed ? 'Mention' : null} />
{/if}
