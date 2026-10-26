<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ProviderCatalog } from '../Catalog.svelte.js';

  let {
    provider,
    label,
    isDefault,
    onConfirm,
    onCancel,
  }: {
    provider: string;
    label: string;
    isDefault: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  const catalog = ProviderCatalog.use();
</script>

<div class="w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-float">
  <h2 class="text-ui font-semibold">Remove {label}?</h2>
  <p class="mt-2 text-ui text-muted-foreground">
    The credential leaves this machine. {catalog.name(provider)} keeps the account itself — signing in again adds it back as a new grant.
  </p>
  {#if isDefault}
    <p class="mt-2 text-ui text-muted-foreground">
      This is the account new threads are born on. Another stored account takes that place, and the list will show which.
    </p>
  {/if}
  <div class="mt-4 flex justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel}>Cancel</Button>
    <Button variant="confirm" size="sm" onclick={onConfirm}>Remove</Button>
  </div>
</div>
