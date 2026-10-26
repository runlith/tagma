<script lang="ts">
  import * as Dialog from './index.js';

  let pending = $state<(() => void) | null>(null);
</script>

<button data-ask onclick={() => (pending = () => undefined)}>Ask</button>

<Dialog.Root
  open={pending !== null}
  onOpenChange={(open) => {
    if (!open) pending = null;
  }}
>
  <Dialog.Content data-asked>
    <Dialog.Title>Discard?</Dialog.Title>
    <button data-keep onclick={() => (pending = null)}>Keep</button>
  </Dialog.Content>
</Dialog.Root>
