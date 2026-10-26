<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Told from '$lib/shared/Told.svelte';
  import type { Told as Telling } from '$lib/wire/told.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { ProjectRenaming } from './Renaming.svelte.js';

  const renaming = ProjectRenaming.use();

  let draft = $state('');
  let refused = $state<Telling | null>(null);
  const project = $derived(renaming.asked);
  const name = $derived(draft.trim());

  $effect.pre(() => {
    draft = project?.name ?? '';
    refused = null;
  });

  function close(): void {
    renaming.dismiss();
  }

  async function rename(): Promise<void> {
    if (project === null || name === '' || name === project.name) return;
    refused = null;
    try {
      await renaming.rename(project, name);
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
        <Dialog.Title class="text-page">Rename “{project.name}”</Dialog.Title>
        <Dialog.Description>The name is the project’s address. Its graph, threads and settings stay with it.</Dialog.Description>
      </Dialog.Header>
      <form
        class="grid gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <Input aria-label="Project name" bind:value={draft} data-runlith-autofocus />
        {#if refused !== null}
          <div class="text-ui text-destructive" role="alert"><Told told={refused} /></div>
        {/if}
      </form>
      <Dialog.Footer>
        <Button variant="outline" data-runlith-autofocus-ignore disabled={renaming.renaming} onclick={close}>Cancel</Button>
        <Button disabled={renaming.renaming || name === '' || name === project.name} onclick={() => void rename()}>Rename</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
