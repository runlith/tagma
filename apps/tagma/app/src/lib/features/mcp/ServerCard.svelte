<script lang="ts">
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { Button } from '$lib/shared/ui/button/index.js';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { scopeName } from '$lib/features/settings/scope.js';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';

  let {
    row,
    scope,
    project,
    busy = false,
    onenabled,
    onremove,
  }: {
    row: McpServerRow;
    scope: SettableScope;
    project: Project | null;
    busy?: boolean;
    onenabled: (enabled: boolean) => void;
    onremove: () => void;
  } = $props();

  const TONE: Record<McpServerRow['status'], string> = {
    connected: 'bg-status-done',
    connecting: 'bg-status-in-work',
    pending: 'bg-vein-strong',
    failed: 'bg-severity-lie',
    disabled: 'bg-status-closed',
  };

  const state = $derived(
    row.status === 'connected'
      ? `connected · ${row.tools} tool${row.tools === 1 ? '' : 's'}`
      : row.status === 'pending'
        ? 'declared; nothing running'
        : row.status,
  );

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
    <span class="text-ui text-muted-foreground tabular">{state}</span>
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
    {#if row.failure}
      <p class="text-small text-destructive">{row.failure}</p>
    {/if}
  </div>
</section>
