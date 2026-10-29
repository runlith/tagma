<script lang="ts">
  import type { ConnectorRow } from '@tagma/server/connectors/contract/wire/rows';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import ConnectorMark from '$lib/features/mcp/ConnectorMark.svelte';
  import StatusMark from '$lib/features/mcp/StatusMark.svelte';
  import { scopeName } from '$lib/features/settings/scope.js';

  let {
    rows,
    scope,
    project,
    busy,
    onconnect,
    ondisconnect,
    onreconnect,
    onsignin,
    onobtain,
  }: {
    rows: readonly ConnectorRow[];
    scope: SettableScope;
    project: Project | null;
    busy: string | null;
    onconnect: (row: ConnectorRow) => void;
    ondisconnect: (row: ConnectorRow) => void;
    onreconnect: (row: ConnectorRow) => void;
    onsignin: (row: ConnectorRow) => void;
    onobtain: (address: string) => void;
  } = $props();

  const STATE: Record<ConnectorRow['state'], string> = {
    available: '',
    connected: 'connected',
    connecting: 'connecting',
    pending: 'declared; nothing running',
    'needs-value': 'needs its key',
    'needs-sign-in': 'needs a sign-in',
    failed: 'failed',
    disabled: 'switched off',
    declined: 'connected, off in this project',
  };
</script>

<ul class="divide-y overflow-hidden rounded-lg border bg-raised">
  {#each rows as row (row.id)}
    <li class="flex min-h-9 items-center gap-3 px-3 py-2" aria-label={row.title}>
      <ConnectorMark icon={row.icon} />
      <div class="grid min-w-0 flex-1">
        <span class="text-ui font-semibold">{row.title}</span>
        <FadeText class="text-small text-muted-foreground" text={row.description} />
      </div>
      {#if row.server && row.state !== 'available'}
        {#if row.server.scope !== scope}
          <span class="eyebrow rounded-md bg-selected px-1.5 py-0.5 text-muted-foreground">{scopeName(row.server.scope, project)}</span>
        {/if}
        <StatusMark status={row.state} />
        <span class="text-ui text-muted-foreground">{row.server.changed ? 'moved to a new address' : STATE[row.state]}</span>
        {#if row.server.changed}
          <Button size="sm" disabled={busy !== null} onclick={() => onreconnect(row)}>Reconnect</Button>
        {:else if row.state === 'needs-sign-in'}
          <Button size="sm" disabled={busy !== null} onclick={() => onsignin(row)}>Sign in</Button>
        {:else if row.state === 'needs-value' && row.signIn.kind === 'key'}
          <Button variant="outline" size="sm" onclick={() => row.signIn.kind === 'key' && onobtain(row.signIn.obtain)}>Get a key</Button>
        {/if}
        <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => ondisconnect(row)}>Disconnect</Button>
      {:else}
        <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => onconnect(row)}>
          {busy === row.id ? 'Connecting…' : 'Connect'}
        </Button>
      {/if}
    </li>
  {/each}
</ul>
