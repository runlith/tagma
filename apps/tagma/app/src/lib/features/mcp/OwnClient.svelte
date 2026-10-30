<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import type { McpSignIn } from '$lib/features/mcp/Repo.js';

  let {
    redirect,
    busy = false,
    open = $bindable(false),
    onsignin,
  }: {
    redirect: string;
    busy?: boolean;
    open?: boolean;
    onsignin: (client: NonNullable<McpSignIn['client']>) => void;
  } = $props();

  let clientId = $state('');
  let clientSecret = $state('');
</script>

<Disclosure bind:open summaryClass="text-small">
  {#snippet summary()}Sign in with a client you registered{/snippet}
  <form
    class="grid gap-2 pt-2"
    onsubmit={(event) => {
      event.preventDefault();
      if (clientId.trim() === '') return;
      onsignin({ id: clientId.trim(), secret: clientSecret === '' ? undefined : clientSecret });
    }}
  >
    <p class="text-small text-muted-foreground">
      Register <code class="stamp break-all text-foreground">{redirect}</code> as its redirect address with the service.
    </p>
    <div class="grid gap-2 sm:grid-cols-2">
      <label class="grid gap-1 text-small text-muted-foreground">
        Client id
        <Input class="font-mono" bind:value={clientId} disabled={busy} />
      </label>
      <label class="grid gap-1 text-small text-muted-foreground">
        Client secret, if the service gave one
        <Input type="password" class="font-mono" autocomplete="new-password" bind:value={clientSecret} disabled={busy} />
      </label>
    </div>
    <div class="flex justify-end">
      <Button size="sm" type="submit" disabled={busy || clientId.trim() === ''}>Sign in with this client</Button>
    </div>
  </form>
</Disclosure>
