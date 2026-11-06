<script lang="ts">
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { repairRequest, ViewRepairs } from './Repairs.js';

  type Props = { title: string; plugin: string; view: string; projectId: number; message: string };

  let { title, plugin, view, projectId, message }: Props = $props();

  const repairs = ViewRepairs.use();
</script>

<Callout tone="error" {title} note={message} clamp class="m-2 bg-background">
  {#snippet actions()}
    <Button size="sm" variant="outline" onclick={() => void repairs.fix(projectId, repairRequest(plugin, view, message))}>
      Fix with an agent
    </Button>
  {/snippet}
</Callout>
