<script lang="ts">
  import Group from '$lib/features/settings/Group.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import { rest, type SectionProps } from '$lib/features/settings/section.js';
  import { McpRepo } from '$lib/features/mcp/Repo.js';

  let { catalog, scope, project }: SectionProps = $props();

  const MANAGED = ['mcp.servers'];
  const mcp = McpRepo.use();

  const serversEntry = $derived(catalog.entriesOf('mcp').find((entry) => entry.id === 'mcp.servers'));
  const declines = $derived(serversEntry !== undefined && catalog.answerOf(serversEntry, 'project').declined);
  const declineOutcome = $derived(catalog.outcomes['mcp.servers']);

  async function decline(declined: boolean): Promise<void> {
    await catalog.write({ scope: 'project', key: 'mcp.servers', declined });
    await mcp.servers.key(project?.id).refresh();
  }
</script>

<div class="grid">
  <Group title="Servers">
    <div class="grid gap-3 pt-1">
      <p class="text-ui text-muted-foreground">MCP servers are added, signed in and switched in Plugins, on the rail of every project.</p>
      {#if scope === 'project' && project !== null && serversEntry !== undefined}
        <div class="grid gap-0.5">
          <div class="flex items-center gap-3">
            <span class="flex-1 text-ui">Use your own servers in this project</span>
            <SwitchControl
              label="Use your own servers in this project"
              value={!declines}
              disabled={catalog.busyKey === 'mcp.servers'}
              onwrite={(on) => void decline(!on)}
            />
          </div>
          {#if declineOutcome?.kind === 'refused'}
            <p class="text-small text-destructive"><span class="stamp">{declineOutcome.code}</span> {declineOutcome.reason}</p>
          {/if}
        </div>
      {/if}
    </div>
  </Group>

  {#if rest(catalog.entriesOf('mcp'), MANAGED).length > 0}
    <KeyCard title="More" entries={rest(catalog.entriesOf('mcp'), MANAGED)} {catalog} {scope} {project} />
  {/if}
</div>
