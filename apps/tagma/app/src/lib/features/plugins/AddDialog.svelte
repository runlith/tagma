<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import AddField from '$lib/features/plugins/AddField.svelte';

  let {
    open = $bindable(false),
    project,
    ondone,
  }: {
    open?: boolean;
    project: Project;
    ondone: (at: string | null) => Promise<unknown>;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title class="text-page">Add by address</Dialog.Title>
      <Dialog.Description>A source of plugins, one plugin, a service's address or a program to run.</Dialog.Description>
    </Dialog.Header>
    <AddField
      {project}
      scope="project"
      ondone={async (at) => {
        open = false;
        await ondone(at);
      }}
      oncancel={() => (open = false)}
    />
  </Dialog.Content>
</Dialog.Root>
