<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { ThreadList } from './List.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import type { Shelving } from './shelving.svelte.js';
  import { folderSubtrees } from './tree.js';

  let { shelving }: { shelving: Shelving } = $props();

  const list = ThreadList.use();
  const workspace = Workspace.use();
  const project = $derived(workspace.find(list.aim.tileId)?.name ?? String(list.aim.tileId));
  const folder = $derived(shelving.removing);
  const inside = $derived(folder === null ? new Set<string>() : folderSubtrees(list.folders, [folder.id]));
  const subfolders = $derived(Math.max(0, inside.size - 1));
  const agents = $derived(
    list.tree.filter((node) => node.row.parentThreadId === null && node.row.folderId != null && inside.has(node.row.folderId)).length,
  );
  const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  const holds = $derived(
    [subfolders > 0 ? plural(subfolders, 'subfolder', 'subfolders') : null, agents > 0 ? plural(agents, 'agent', 'agents') : null]
      .filter((part) => part !== null)
      .join(' and '),
  );
</script>

{#if folder !== null}
  <Dialog.Root
    open
    onOpenChange={(next) => {
      if (!next) shelving.removing = null;
    }}
  >
    <Dialog.Content class="gap-4 sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title class="text-page">Remove “{folder.name}”?</Dialog.Title>
        <Dialog.Description>
          {holds === '' ? 'The folder is empty.' : `It holds ${holds}. The agents stay in the list.`}
        </Dialog.Description>
        <p class="break-all text-small text-muted-foreground">Project: {project} · folder {folder.id}</p>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (shelving.removing = null)}>Cancel</Button>
        <Button variant="confirm" onclick={() => void shelving.confirmRemove()}>Remove</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
