<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { Links } from '$lib/features/browser/Links.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { href, beside }: { href: string; beside?: () => void } = $props();

  const COPIED_MS = 1_500;

  const links = Links.use();

  let copied = $state(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(href);
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }
</script>

<div class="flex shrink-0 items-center">
  {#if beside !== undefined}
    <Tooltip text="Open in the panel">
      <Button variant="ghost" size="icon-sm" aria-label="Open in the panel" onclick={beside}>
        <PanelRight class="size-3.5" />
      </Button>
    </Tooltip>
  {/if}
  <Tooltip text="Open in your browser">
    <Button variant="ghost" size="icon-sm" aria-label="Open in your browser" onclick={() => links.system(href)}>
      <ExternalLink class="size-3.5" />
    </Button>
  </Tooltip>
  <Tooltip text={copied ? 'Copied' : 'Copy the link'}>
    <Button variant="ghost" size="icon-sm" aria-label="Copy the link" onclick={() => void copy()}>
      {#if copied}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
    </Button>
  </Tooltip>
</div>
