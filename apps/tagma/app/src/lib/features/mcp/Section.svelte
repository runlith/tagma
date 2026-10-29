<script lang="ts">
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import { McpRepo, type McpDeclarationInput } from '$lib/features/mcp/Repo.js';
  import { scopeName } from '$lib/features/settings/scope.js';
  import Group from '$lib/features/settings/Group.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import McpDeclarationForm from '$lib/features/mcp/DeclarationForm.svelte';
  import McpServerCard from '$lib/features/mcp/ServerCard.svelte';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import { rest, type SectionProps } from '$lib/features/settings/section.js';

  let { catalog, scope, project }: SectionProps = $props();

  const MANAGED = ['mcp.servers'];
  const mcp = McpRepo.use();
  const secrets = SecretsRepo.use();
  const rows = $derived(mcp.servers.key(project?.id).data ?? []);
  const projectId = $derived(project?.id);
  const sets = $derived(projectId === undefined ? [] : (secrets.sets.key({ projectId, owner: 'mcp' }).data ?? []));

  async function refreshed(): Promise<void> {
    await Promise.all([
      mcp.servers.key(projectId).refresh(),
      projectId === undefined ? undefined : secrets.sets.key({ projectId, owner: 'mcp' }).refresh(),
    ]);
  }
  const setOf = (row: McpServerRow) => sets.find((set) => set.id === `${row.scope}/${row.name}`);
  const reading = $derived(mcp.servers.key(project?.id).isPending);
  const failed = $derived(mcp.servers.key(project?.id).error);

  let adding = $state(false);
  let busy = $state<string | null>(null);
  let refusal = $state<{ code: string; reason: string; unblock: readonly string[] } | undefined>(undefined);

  function said(caught: unknown): { code: string; reason: string; unblock: readonly string[] } {
    return caught instanceof Refusal
      ? { code: caught.code, reason: caught.reason, unblock: caught.unblock }
      : { code: 'failed', reason: caught instanceof Error ? caught.message : String(caught), unblock: [] };
  }

  async function add(declaration: McpDeclarationInput): Promise<void> {
    busy = declaration.name;
    refusal = undefined;
    try {
      await mcp.add.run({ projectId: project?.id, scope, declaration }, { throwOnError: true });
      await refreshed();
      adding = false;
    } catch (caught) {
      refusal = said(caught);
    } finally {
      busy = null;
    }
  }

  async function remove(row: McpServerRow): Promise<void> {
    busy = row.name;
    refusal = undefined;
    try {
      await mcp.remove.run({ projectId: project?.id, scope, name: row.name }, { throwOnError: true });
      await refreshed();
    } catch (caught) {
      refusal = said(caught);
    } finally {
      busy = null;
    }
  }

  async function setEnabled(row: McpServerRow, enabled: boolean): Promise<void> {
    busy = row.name;
    refusal = undefined;
    try {
      await mcp.setEnabled.run({ projectId: project?.id, scope, name: row.name, enabled }, { throwOnError: true });
      await mcp.servers.key(project?.id).refresh();
    } catch (caught) {
      refusal = said(caught);
    } finally {
      busy = null;
    }
  }

  const connecting = $derived(rows.some((row) => row.status === 'connecting'));

  const WHILE_CONNECTING_MS = 1000;

  $effect(() => {
    if (!connecting) return;
    const again = setInterval(() => {
      void mcp.servers
        .key(project?.id)
        .refresh()
        .catch(() => undefined);
    }, WHILE_CONNECTING_MS);
    return () => clearInterval(again);
  });
</script>

<div class="grid">
  <Group title="Servers">
    {#snippet fact()}
      {#if rows.length > 0}<span class="tabular">{rows.length} declared</span>{/if}
    {/snippet}
    {#snippet act()}
      {#if !adding}
        <Button variant="outline" size="sm" onclick={() => ((adding = true), (refusal = undefined))}>
          <Plus class="size-3.5" />
          Add server
        </Button>
      {/if}
    {/snippet}

    <div class="grid gap-3 pt-1">
      {#if adding}
        <div class="overflow-hidden rounded-lg border">
          <p class="bg-sunken px-3 pt-3 text-small text-muted-foreground">
            Lands on <span class="font-medium text-foreground">{scopeName(scope, project)}</span>.
          </p>
          <McpDeclarationForm
            busy={busy !== null}
            {refusal}
            onsubmit={(declaration) => void add(declaration)}
            oncancel={() => ((adding = false), (refusal = undefined))}
          />
        </div>
      {/if}

      {#if failed}
        <p class="text-ui text-destructive">
          The servers could not be read: {failed instanceof Error ? failed.message : String(failed)}
        </p>
      {:else if reading && rows.length === 0}
        <p class="text-ui text-muted-foreground">Reading the servers…</p>
      {:else if rows.length === 0 && !adding}
        <p class="text-ui text-muted-foreground">
          No MCP servers for {scopeName(scope, project)} yet. Add one here, or with
          <code class="stamp">add_mcp_server</code> in a thread — both land on the same key.
        </p>
      {/if}

      {#each rows as row (row.scope + row.name)}
        <McpServerCard
          {row}
          {scope}
          {project}
          busy={busy === row.name}
          secrets={setOf(row)}
          onenabled={(enabled) => void setEnabled(row, enabled)}
          onremove={() => void remove(row)}
          onsecret={() => mcp.servers.key(project?.id).refresh()}
        />
      {/each}

      {#if refusal && !adding}
        <div class="grid gap-0.5 text-small">
          <p class="text-destructive"><span class="stamp">{refusal.code}</span> — {refusal.reason}</p>
          {#each refusal.unblock as way (way)}
            <p class="text-muted-foreground">{way}</p>
          {/each}
        </div>
      {/if}
    </div>
  </Group>

  {#if rest(catalog.entriesOf('mcp'), MANAGED).length > 0}
    <KeyCard title="More" entries={rest(catalog.entriesOf('mcp'), MANAGED)} {catalog} {scope} {project} />
  {/if}
</div>
