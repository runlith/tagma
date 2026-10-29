<script lang="ts">
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import type { SecretSet } from '@tagma/server/secrets/contract/wire/rows';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SecretFields from '$lib/features/secrets/SecretFields.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { scopeName } from '$lib/features/settings/scope.js';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { McpSignIn } from '$lib/features/mcp/Repo.js';

  let {
    row,
    scope,
    project,
    busy = false,
    secrets,
    onenabled,
    onremove,
    onsecret,
    onsignin,
    onsignout,
  }: {
    row: McpServerRow;
    scope: SettableScope;
    project: Project | null;
    busy?: boolean;
    secrets?: SecretSet;
    onenabled: (enabled: boolean) => void;
    onremove: () => void;
    onsecret: () => Promise<unknown>;
    onsignin: (client: McpSignIn['client']) => void;
    onsignout: () => void;
  } = $props();

  const TONE: Record<McpServerRow['status'], string> = {
    connected: 'bg-status-done',
    connecting: 'bg-status-in-work',
    pending: 'bg-vein-strong',
    'needs-value': 'bg-status-open',
    'needs-sign-in': 'bg-status-open',
    failed: 'bg-severity-lie',
    disabled: 'bg-status-closed',
  };

  const standing = $derived(
    row.status === 'connected'
      ? `connected · ${row.tools} tool${row.tools === 1 ? '' : 's'}`
      : row.status === 'pending'
        ? 'declared; nothing running'
        : row.status === 'needs-value'
          ? `needs ${(row.needs ?? []).join(', ')}`
          : row.status === 'needs-sign-in'
            ? 'needs a sign-in'
            : row.status,
  );

  const CLIENT: Record<NonNullable<NonNullable<McpServerRow['signIn']>['client']>, string> = {
    'pre-registered': 'with the client you registered',
    document: 'with Tagma’s client document',
    registered: 'with a client Tagma registered',
  };

  let clientId = $state('');
  let clientSecret = $state('');
  let own = $state(false);

  const signIn = $derived(row.signIn);
  const asks = $derived(signIn !== undefined && (row.status === 'needs-sign-in' || signIn.pending));

  const reach = $derived(
    row.reach.transport === 'stdio'
      ? [
          'stdio',
          [row.reach.command, ...(row.reach.args ?? [])].join(' '),
          row.reach.cwd ? `in ${row.reach.cwd}` : null,
          row.reach.env.length > 0 ? `env: ${row.reach.env.join(', ')}` : null,
        ]
      : ['http', row.reach.url, row.reach.headers.length > 0 ? `headers: ${row.reach.headers.join(', ')}` : null],
  );

  const mine = $derived(row.scope === scope);
</script>

<section class="overflow-hidden rounded-lg border bg-raised" aria-label={row.name}>
  <div class="flex min-h-9 flex-wrap items-center gap-2 px-3 py-1">
    <h4 class="text-ui font-semibold">{row.name}</h4>
    <span class="eyebrow rounded-md bg-selected px-1.5 py-0.5 text-muted-foreground">
      {scopeName(row.scope, project)}
    </span>
    <Tooltip text={row.status}>
      <span class="size-2 shrink-0 rounded-full {TONE[row.status]}"></span>
    </Tooltip>
    <span class="text-ui text-muted-foreground tabular">{standing}</span>
    {#if row.shadows}
      <span class="text-small text-muted-foreground">· stands in front of the {row.shadows} entry</span>
    {/if}
    <span class="flex-1"></span>
    <SwitchControl label="{row.name} enabled" value={row.enabled} disabled={busy || !mine} onwrite={(enabled) => onenabled(enabled)} />
    <Button variant="outline" size="sm" disabled={busy || !mine} onclick={onremove}>
      {mine ? 'Remove' : `Declared for ${scopeName(row.scope, project)}`}
    </Button>
  </div>

  <div class="grid gap-1.5 border-t border-border bg-sunken/40 px-3 py-2">
    <p class="stamp min-w-0 break-all text-muted-foreground">
      {reach.filter((part) => part !== null).join(' · ')}
    </p>
    {#if row.capabilities.kinds.length > 0 || row.capabilities.mutates}
      <div class="flex flex-wrap items-center gap-1">
        {#each row.capabilities.kinds as kind (kind)}
          <span class="eyebrow rounded-md border border-vein px-1.5 py-0.5 text-muted-foreground capitalize">{kind}</span>
        {/each}
        {#if row.capabilities.mutates}
          <span class="eyebrow rounded-md bg-mutation/12 px-1.5 py-0.5 text-mutation">Mutates</span>
        {/if}
      </div>
    {/if}
    {#if row.failure && row.status !== 'needs-sign-in'}
      <p class="text-small text-destructive">{row.failure}</p>
    {/if}
  </div>

  {#if signIn !== undefined && (asks || signIn.signedIn)}
    <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3">
      <div class="flex flex-wrap items-center gap-2">
        {#if signIn.pending}
          <Waiting class="size-3" />
          <span class="text-ui text-muted-foreground">Waiting for the sign-in in your browser</span>
        {:else if asks && signIn.signedIn}
          <span class="text-ui text-muted-foreground">The service asks for a new sign-in before it serves these tools</span>
        {:else if asks}
          <span class="text-ui text-muted-foreground">The service asks Tagma to sign in before it serves its tools</span>
        {:else}
          <span class="text-ui">Signed in</span>
          {#if signIn.client !== null}<span class="text-ui text-muted-foreground">{CLIENT[signIn.client]}</span>{/if}
        {/if}
        <span class="flex-1"></span>
        {#if signIn.signedIn}
          <Button variant="outline" size="sm" disabled={busy} onclick={onsignout}>Sign out</Button>
        {/if}
        {#if asks}
          <Button size="sm" disabled={busy} onclick={() => onsignin(undefined)}>{signIn.pending ? 'Sign in again' : 'Sign in'}</Button>
        {/if}
      </div>
      {#if asks && signIn.redirect !== null}
        <Disclosure bind:open={own} summaryClass="text-small">
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
              Register <code class="stamp break-all text-foreground">{signIn.redirect}</code> as its redirect address with the service.
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
      {/if}
    </div>
  {/if}

  {#if secrets && project}
    <SecretFields set={secrets} projectId={project.id} onchanged={onsecret} />
  {/if}
</section>
