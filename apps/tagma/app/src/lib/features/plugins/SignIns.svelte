<script lang="ts">
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { McpRepo } from '$lib/features/mcp/Repo.js';

  let { projectId, plugin }: { projectId: number; plugin: string } = $props();

  const mcp = McpRepo.use();
  const links = ExternalLinks.use();
  const notices = Notices.use();

  const asking = $derived(
    (mcp.servers.key(projectId).data ?? []).filter(
      (row: McpServerRow) =>
        row.scope === 'contributed' &&
        row.contributor === plugin &&
        row.signIn !== undefined &&
        (row.status === 'needs-sign-in' || row.signIn.pending),
    ),
  );

  let busy = $state<string | null>(null);

  async function signIn(row: McpServerRow): Promise<void> {
    busy = row.name;
    try {
      const url = await mcp.signIn.run({ projectId, scope: 'contributed', name: row.name }, { throwOnError: true });
      if (url !== undefined) links.open(url);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }
</script>

{#if asking.length > 0}
  <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3">
    <p class="text-small text-muted-foreground">Its remote servers ask Tagma to sign in before they serve their tools</p>
    {#each asking as row (row.name)}
      <div class="flex min-w-0 items-center gap-2" data-sign-in={row.name}>
        <FadeText text={row.name} class="stamp min-w-0 flex-1" />
        {#if row.signIn?.pending}
          <Waiting class="size-3" />
          <span class="text-small text-muted-foreground">Waiting for the browser</span>
        {/if}
        <Button size="sm" disabled={busy !== null} onclick={() => void signIn(row)}>
          {row.signIn?.pending ? 'Sign in again' : 'Sign in'}
        </Button>
      </div>
    {/each}
  </div>
{/if}
