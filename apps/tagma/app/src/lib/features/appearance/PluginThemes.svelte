<script lang="ts">
  import Swatches from '$lib/features/settings/controls/Swatches.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Appearance } from './Appearance.svelte.js';

  let { plugin }: { plugin: string } = $props();

  const appearance = Appearance.use();

  const themes = $derived(appearance.offered.filter((offered) => offered.plugin === plugin));
</script>

{#if themes.length > 0}
  <section class="grid gap-2" aria-label="Themes" data-plugin-themes={plugin}>
    <h3 class="text-small font-medium text-muted-foreground">Themes</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each themes as offered (offered.id)}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small" data-theme={offered.id}>
          <Swatches colours={appearance.coloursOf(offered.theme)} />
          <FadeText class="min-w-0 flex-1" text={offered.theme.title} />
          {#if appearance.chosen === offered.id}
            <span class="shrink-0 text-muted-foreground">In use</span>
          {:else}
            <Button variant="outline" size="xs" onclick={() => appearance.chooseTheme(offered.id)}>Use</Button>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
