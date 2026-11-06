<script lang="ts">
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { TAGMA_THEME } from '@tagma/server/appearance/contract/wire/format';
  import { PLUGINS_FIND_LINK } from '@tagma/server/plugins/contract/wire/link';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Asking } from '$lib/features/threads/Asking.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Appearance } from './Appearance.svelte.js';

  let { project }: SectionProps = $props();

  const appearance = Appearance.use();
  const opening = Opening.use();
  const asking = Asking.use();

  const THEME_REQUEST = 'Make me a Tagma theme of my own that ';
</script>

{#if appearance.missing}
  <Callout tone="plain" title="{appearance.chosen} is not installed" note="Tagma's own theme stands until its plugin is on again.">
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => appearance.chooseTheme(TAGMA_THEME)}>Use Tagma</Button>
    {/snippet}
  </Callout>
{/if}
{#if project !== null}
  <div class="flex flex-wrap items-center gap-2">
    <Button
      size="sm"
      variant="outline"
      onclick={() => void opening.open({ kind: PLUGINS_FIND_LINK, target: { projectId: project.id, query: 'theme' } }, 'full')}
    >
      Find themes
    </Button>
    <Button size="sm" variant="ghost" onclick={() => void asking.draft({ projectId: project.id }, THEME_REQUEST)}>
      Make a theme with an agent
    </Button>
  </div>
{/if}
