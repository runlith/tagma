<script lang="ts">
  import Button from '$lib/shared/ui/button/button.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import GitDiff from '$lib/features/checkout/GitDiff.svelte';
  import CompareTab from './CompareTab.svelte';
  import FileTab from './FileTab.svelte';
  import ImageTab from './ImageTab.svelte';
  import PreviewTab from './PreviewTab.svelte';
  import TabStrip from './TabStrip.svelte';
  import { inCheckout } from './tab.js';
  import { Tabs } from './Tabs.svelte.js';

  const tabs = Tabs.use();
  const keymap = Keymap.use();

  const active = $derived(tabs.active);
  const find = $derived(keymap.spell('palette.files'));
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col" data-editor-area>
  {#if tabs.tabs.length > 0}
    <TabStrip />
  {/if}
  <div class="min-h-0 flex-1">
    {#if active === null}
      <p class="grid h-full place-items-center px-6 text-center text-ui text-muted-foreground" data-checkout-pick>
        <span
          >Open a file from the tree{#if find !== null}, or press <Kbd chord={find} /> to find one{/if}</span
        >
      </p>
    {:else}
      {#each [active] as tab (tab.id)}
        {#if tabs.orphaned(tab)}
          <div class="grid h-full place-content-center justify-items-center gap-2 px-6 text-center" data-tab-orphan={tab.path}>
            <p class="text-ui text-muted-foreground">The checkout of {tab.branch} is gone, so {tab.path} can no longer be read.</p>
            <Button size="sm" variant="outline" onclick={() => tabs.close(tab.id)}>Close the tab</Button>
          </div>
        {:else if tab.kind === 'diff' && inCheckout(tab)}
          <GitDiff {tab} />
        {:else if tab.kind === 'image'}
          <ImageTab {tab} projectId={tabs.projectId} />
        {:else if tab.kind === 'compare'}
          <CompareTab {tab} />
        {:else if tab.kind === 'preview'}
          <PreviewTab
            {tab}
            projectId={tabs.projectId}
            onSource={() => tabs.open({ rootId: tab.rootId, branch: tab.branch, path: tab.path, kind: 'file' }, 'open')}
          />
        {:else}
          <FileTab
            {tab}
            projectId={tabs.projectId}
            onSeen={(view) => {
              tabs.see(tab.id, view);
              tabs.arrived(tab.id);
            }}
            onEdit={() => tabs.keep(tab.id)}
            onPreview={() => tabs.open({ rootId: tab.rootId, branch: tab.branch, path: tab.path, kind: 'preview' }, 'open')}
          />
        {/if}
      {/each}
    {/if}
  </div>
</div>
