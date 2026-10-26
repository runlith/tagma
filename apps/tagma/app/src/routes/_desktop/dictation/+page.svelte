<script lang="ts">
  import { DesktopDictation } from '$lib/shared/desktop/DesktopDictation.js';
  import Pill from '$lib/features/speech/dictation/Pill.svelte';

  const desktop = DesktopDictation.find();
</script>

<svelte:head><title>Dictation</title></svelte:head>

{#if desktop !== undefined}
  <Pill {desktop} />
{/if}
