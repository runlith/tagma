<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { STATUS_BAR_HEIGHT } from '$lib/shared/statusBar.js';
  import CheckoutTenant from '$lib/features/checkout/CheckoutTenant.svelte';
  import TerminalToggle from '$lib/features/executions/terminal/Toggle.svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import AwakeControl from './AwakeControl.svelte';
  import FaultsButton from './FaultsButton.svelte';
  import LoadButton from './LoadButton.svelte';
  import StandingChip from './StandingChip.svelte';
  import UsageMeters from './UsageMeters.svelte';

  const router = Router.use();
  const inProject = $derived(Boolean(router.params.project));
  const projectAim = ProjectRung.Source.use();
  const projectKey = $derived.by(() => {
    const aim = projectAim();
    return aim === undefined ? null : ProjectRung.keyOf(aim);
  });
  const graphAim = GraphRung.Source.use();
  const graphKey = $derived.by(() => {
    const aim = graphAim();
    return aim === undefined ? null : GraphRung.keyOf(aim);
  });
</script>

<footer
  class="flex shrink-0 items-center border-t border-border bg-chrome pr-3 pl-1.5 stamp text-muted-foreground"
  style="height: {STATUS_BAR_HEIGHT}px"
  data-status-bar
>
  <span class="flex min-w-0 flex-1 items-center gap-3">
    {#if inProject && projectKey !== null}
      {#key projectKey}<TerminalToggle />{/key}
      <span class="h-3 w-px shrink-0 bg-border" aria-hidden="true"></span>
    {/if}
    <StandingChip />
    {#if graphKey !== null}
      {#key graphKey}
        <CheckoutTenant />
      {/key}
    {/if}
  </span>
  <FaultsButton />
  <LoadButton />
  <AwakeControl />
  <UsageMeters />
</footer>
