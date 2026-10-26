<script lang="ts">
  import * as Dialog from '../dialog/index.js';
  import * as Select from './index.js';

  let {
    modal = false,
    fruits = ['apple', 'banana', 'avocado', 'cherry'],
    value = $bindable('banana'),
  }: { modal?: boolean; fruits?: readonly string[]; value?: string } = $props();

  let open = $state(true);
</script>

{#snippet choice()}
  <Select.Root bind:value>
    <Select.Trigger data-trigger>{value}</Select.Trigger>
    <Select.Content>
      {#each fruits as fruit (fruit)}
        <Select.Item value={fruit} label={fruit} data-item={fruit} />
      {/each}
    </Select.Content>
  </Select.Root>
{/snippet}

{#if modal}
  <Dialog.Root bind:open>
    <Dialog.Content>
      <Dialog.Title>Fruit</Dialog.Title>
      {@render choice()}
    </Dialog.Content>
  </Dialog.Root>
{:else}
  {@render choice()}
{/if}
