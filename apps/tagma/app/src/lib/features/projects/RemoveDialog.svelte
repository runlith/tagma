<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import Told from '$lib/shared/Told.svelte';
  import type { Told as Telling } from '$lib/wire/told.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { ProjectPulse } from './Pulse.svelte.js';
  import { ProjectRemoval } from './Removal.svelte.js';

  const removal = ProjectRemoval.use();
  const pulse = ProjectPulse.use();

  let refused = $state<Telling | null>(null);
  const project = $derived(removal.asked);
  const working = $derived(project === null ? 0 : pulse.of(project.id).working);

  function close(): void {
    refused = null;
    removal.dismiss();
  }

  async function remove(): Promise<void> {
    if (project === null) return;
    refused = null;
    try {
      await removal.remove(project);
    } catch (error) {
      refused = toldOf(error);
    }
  }
</script>

{#if project !== null}
  <Dialog.Root
    open
    onOpenChange={(next) => {
      if (!next) close();
    }}
  >
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title class="text-page">Remove “{labelOf(project)}” from Tagma?</Dialog.Title>
        <Dialog.Description>
          It leaves the project list. Nothing is deleted from disk: the folder, its graph and its threads stay where they are.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2 text-ui">
        <p class="text-muted-foreground">Add this folder again to bring the project back with its graph and threads.</p>
        <p class="font-mono text-small break-all text-muted-foreground">{project.rootPath}</p>
        {#if working > 0}
          <p>{working === 1 ? 'The agent working here stops.' : `The ${working} agents working here stop.`}</p>
        {/if}
        {#if refused !== null}
          <div class="text-destructive" role="alert"><Told told={refused} /></div>
        {/if}
      </div>
      <Dialog.Footer>
        <Button variant="outline" data-runlith-autofocus-ignore disabled={removal.removing} onclick={close}>Cancel</Button>
        <Button disabled={removal.removing} onclick={() => void remove()}>Remove from Tagma</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
