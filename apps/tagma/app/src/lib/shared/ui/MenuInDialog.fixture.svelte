<script lang="ts">
  import Circle from '@lucide/svelte/icons/circle';
  import * as Dialog from './dialog/index.js';
  import * as DropdownMenu from './dropdown-menu/index.js';

  let open = $state(true);
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>Actions</Dialog.Title>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger data-menu-trigger>More</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={Circle}>First</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Dialog.Content>
</Dialog.Root>
