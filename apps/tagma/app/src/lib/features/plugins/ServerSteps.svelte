<script lang="ts">
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { McpRepo } from '$lib/features/mcp/Repo.js';
  import { serverState, waitsOnSignIn } from '$lib/features/plugins/here.js';

  let { projectId, servers }: { projectId: number; servers: readonly McpServerRow[] } = $props();

  const mcp = McpRepo.use();
  const links = ExternalLinks.use();
  const notices = Notices.use();

  let busy = $state<string | null>(null);

  const hostOf = (row: McpServerRow): string =>
    row.reach.transport === 'http' && URL.canParse(row.reach.url) ? new URL(row.reach.url).host : row.name;

  async function signIn(row: McpServerRow): Promise<void> {
    busy = row.name;
    try {
      const url = await mcp.signIn.run({ projectId, scope: row.scope, name: row.name }, { throwOnError: true });
      if (url !== undefined) links.open(url);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }
</script>

{#each servers as row (row.scope + row.name)}
  {@const state = serverState(row)}
  <div class="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2" data-server={row.name}>
    <span class="grid h-5 place-items-center">
      {#if state === 'connecting' || row.signIn?.pending}
        <Waiting class="size-3" />
      {:else}
        <span
          class={[
            'size-2',
            state === 'waits' && 'bg-status-open',
            state === 'fails' && 'bg-destructive',
            state === 'ok' && 'bg-status-done',
            state === 'off' && 'border border-dashed border-muted-foreground',
          ]}
        ></span>
      {/if}
    </span>
    <span class="grid min-w-0 gap-0.5">
      {#if row.status === 'connected'}
        <span class="text-ui font-medium">Connected to {hostOf(row)}</span>
        <span class="text-small text-muted-foreground tabular">{row.tools} {row.tools === 1 ? 'tool' : 'tools'} agents can call</span>
      {:else if waitsOnSignIn(row)}
        <span class="text-ui font-medium">Sign in to {hostOf(row)}</span>
        <span class="text-small text-muted-foreground">
          {row.signIn?.pending ? 'Waiting for the browser.' : 'Opens its sign-in page in your browser. Agents never sign in for you.'}
        </span>
      {:else if row.status === 'needs-value'}
        <span class="text-ui font-medium">{row.name} needs a value</span>
        <FadeText text={(row.needs ?? []).join(', ')} class="stamp text-muted-foreground" />
      {:else if row.status === 'failed'}
        <span class="text-ui font-medium">{row.name} does not start</span>
        <span class="stamp text-muted-foreground">{row.failure ?? ''}</span>
      {:else if state === 'off'}
        <span class="text-ui text-muted-foreground">{row.name} is off here</span>
      {:else}
        <span class="text-ui text-muted-foreground">Connecting to {hostOf(row)}</span>
      {/if}
    </span>
    {#if waitsOnSignIn(row)}
      <Button size="sm" disabled={busy !== null} onclick={() => void signIn(row)}>
        {row.signIn?.pending ? 'Sign in again' : 'Sign in'}
      </Button>
    {/if}
  </div>
{/each}
