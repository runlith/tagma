<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { Snippet } from 'svelte';
  import { McpFeed } from '$lib/features/mcp/Feed.js';
  import { McpRepo } from '$lib/features/mcp/Repo.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { serverState } from './here.js';

  let { project, children }: { project: Project; children: Snippet } = $props();

  const feed = McpFeed.use();
  const mcp = McpRepo.use();

  $effect(() => feed.hold(project.id));

  const waiting = $derived((mcp.servers.key(project.id).data ?? []).filter((row) => serverState(row) === 'waits').length);
</script>

<Badge count={waiting} tone="open" class="top-0.5 right-0.5">{@render children()}</Badge>
