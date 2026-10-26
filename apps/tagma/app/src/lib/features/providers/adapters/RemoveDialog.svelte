<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';

  let { id, onConfirm, onCancel }: { id: string; onConfirm: () => void; onCancel: () => void } = $props();
</script>

<div class="w-96 max-w-full rounded-lg border bg-popover p-4 text-popover-foreground shadow-float">
  <h2 class="text-ui font-semibold">Remove {id}?</h2>
  <p class="mt-2 text-ui text-muted-foreground">
    The adapter and its files leave this machine. Its providers stop serving until it is installed again; the accounts and keys they held
    stay.
  </p>
  <div class="mt-4 flex justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel}>Cancel</Button>
    <Button variant="confirm" size="sm" onclick={onConfirm}>Remove</Button>
  </div>
</div>
