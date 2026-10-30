<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Told from '$lib/shared/Told.svelte';
  import type { Told as Telling } from '$lib/wire/told.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { ProjectGrouping } from './Grouping.svelte.js';

  const grouping = ProjectGrouping.use();

  let draft = $state('');
  let refused = $state<Telling | null>(null);
  const pair = $derived(grouping.asked);
  const name = $derived(draft.trim());

  $effect.pre(() => {
    void pair;
    draft = '';
    refused = null;
  });

  async function form(): Promise<void> {
    if (pair === null || name === '') return;
    refused = null;
    try {
      await grouping.form(pair, name);
    } catch (error) {
      refused = toldOf(error);
    }
  }
</script>

{#if pair !== null}
  <Dialog.Root
    open
    onOpenChange={(next) => {
      if (!next) grouping.dismiss();
    }}
  >
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title class="text-page">Group “{labelOf(pair.first)}” and “{labelOf(pair.second)}”</Dialog.Title>
        <Dialog.Description>Both keep their own repository, graph and law; their agents share one list.</Dialog.Description>
      </Dialog.Header>
      <form
        class="grid gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void form();
        }}
      >
        <Input aria-label="Group name" placeholder="Group name" bind:value={draft} data-runlith-autofocus />
        {#if refused !== null}
          <div class="text-ui text-destructive" role="alert"><Told told={refused} /></div>
        {/if}
      </form>
      <Dialog.Footer>
        <Button variant="outline" data-runlith-autofocus-ignore disabled={grouping.pending} onclick={() => grouping.dismiss()}
          >Cancel</Button
        >
        <Button disabled={grouping.pending || name === ''} onclick={() => void form()}>Group</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
