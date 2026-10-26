<script lang="ts">
  import type { AccessProblem, Blocked } from '@tagma/server/remote/contract/wire/access';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Copy from './Copy.svelte';

  let { blocked, machine, onretry }: { blocked: Blocked; machine: string; onretry: () => void } = $props();

  const HEADLINE: Record<AccessProblem, (machine: string) => string> = {
    'not-installed': (on) => `Tailscale isn't installed on ${on}`,
    'signed-out': () => 'Open Tailscale and sign in',
    'https-off': () => 'HTTPS certificates are off in your tailnet',
    'needs-operator': () => 'Tailscale needs your permission to serve Tagma',
    'port-taken': () => 'Tailscale Serve is already using both ports Tagma can take',
    'origin-taken': () => "Tagma's address in Tailscale now serves something else",
    'funnel-on': () => 'Tailscale Funnel would open Tagma to the whole internet',
    'listener-failed': () => "Tagma couldn't open its door for your phone",
    refused: () => 'Tailscale refused to serve Tagma',
  };

  const LINK_LABEL: Partial<Record<AccessProblem, string>> = {
    'not-installed': 'Get Tailscale',
    'https-off': 'Turn on',
  };

  const command = $derived(blocked.command);
</script>

<div class="grid gap-3 px-3 py-3 pointer-coarse:px-4">
  <div class="flex items-start gap-2">
    <TriangleAlert class="mt-0.5 size-4 shrink-0 text-status-stale" />
    <div class="grid min-w-0 gap-1">
      <p class="text-ui font-medium pointer-coarse:text-body">{HEADLINE[blocked.problem](machine)}</p>
      {#if blocked.detail !== ''}
        <p class="text-small break-words text-muted-foreground">{blocked.detail}</p>
      {/if}
    </div>
  </div>
  {#if blocked.link !== null}
    <div>
      <Button href={blocked.link} target="_blank" rel="noopener noreferrer" size="sm" class="pointer-coarse:h-11 pointer-coarse:px-4">
        {LINK_LABEL[blocked.problem] ?? 'Open'}
      </Button>
    </div>
  {:else if command !== null}
    <div class="flex min-w-0 items-center gap-2 rounded-md bg-sunken py-1 pr-1 pl-3">
      <code class="min-w-0 flex-1 truncate font-mono text-small">{command}</code>
      <Copy text={command} label="Copy the command" />
    </div>
    <p class="text-small text-muted-foreground">Run it once in a terminal on {machine}; Tagma picks it up by itself.</p>
  {:else}
    <div>
      <Button variant="outline" size="sm" class="pointer-coarse:h-11 pointer-coarse:px-4" onclick={onretry}>Check again</Button>
    </div>
  {/if}
</div>
