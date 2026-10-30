<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { McpRepo, type McpSignIn } from '$lib/features/mcp/Repo.js';
  import McpServerCard from '$lib/features/mcp/ServerCard.svelte';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import Tile from '$lib/features/plugins/Tile.svelte';

  let { row, project, onremoved }: { row: McpServerRow; project: Project; onremoved: () => void } = $props();

  const mcp = McpRepo.use();
  const secrets = SecretsRepo.use();
  const links = ExternalLinks.use();

  const scope = $derived<SettableScope>(row.scope === 'user' ? 'user' : 'project');
  const secretSet = $derived(
    secrets.sets.key({ projectId: project.id, owner: 'mcp' }).data?.find((set) => set.id === `${row.scope}/${row.name}`),
  );
  const where = $derived(row.scope === 'user' ? 'Yours, in every project' : `Declared for ${project.name}`);

  let busy = $state(false);
  let failed = $state<Told | undefined>(undefined);

  async function act(work: () => Promise<unknown>): Promise<void> {
    busy = true;
    failed = undefined;
    try {
      await work();
      await mcp.servers.key(project.id).refresh();
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      busy = false;
    }
  }

  const onenabled = (enabled: boolean) =>
    void act(() => mcp.setEnabled.run({ projectId: project.id, scope: row.scope, name: row.name, enabled }, { throwOnError: true }));
  const onremove = () =>
    void act(async () => {
      await mcp.remove.run({ projectId: project.id, scope, name: row.name }, { throwOnError: true });
      onremoved();
    });
  const onsignin = (client: McpSignIn['client']) =>
    void act(async () => {
      const url = await mcp.signIn.run({ projectId: project.id, scope: row.scope, name: row.name, client }, { throwOnError: true });
      if (url !== undefined) links.open(url);
    });
  const onsignout = () =>
    void act(() => mcp.signOut.run({ projectId: project.id, scope: row.scope, name: row.name }, { throwOnError: true }));
</script>

<div class="mx-auto grid w-full max-w-3xl content-start gap-6 px-8 py-6">
  <header class="grid grid-cols-[auto_1fr] items-center gap-4">
    <Tile title={row.name} size="lg" />
    <div class="grid min-w-0 gap-0.5">
      <FadeText text={row.name} class="text-title font-semibold" />
      <span class="text-small text-muted-foreground">{where}</span>
    </div>
  </header>
  {#if failed !== undefined}<Callout tone="error" title={failed.text} note={failed.note} />{/if}
  <McpServerCard
    {row}
    {scope}
    {project}
    {busy}
    secrets={secretSet}
    {onenabled}
    {onremove}
    onsecret={() => mcp.servers.key(project.id).refresh()}
    {onsignin}
    {onsignout}
  />
</div>
