<script lang="ts">
  import Coffee from '@lucide/svelte/icons/coffee';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Awake } from '$lib/features/power/Awake.svelte.js';

  const awake = Awake.use();
  const router = Router.use();

  const state = $derived(awake.standing?.state ?? null);
  const failure = $derived(state !== null && (state._tag === 'failed' || state._tag === 'unavailable') ? state : null);
</script>

{#if failure !== null}
  <Tooltip text={`Keep awake is not holding: ${failure.reason} Work continues unprotected.`}>
    <a
      href={settingsHref(router)}
      class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-destructive transition-colors hover:bg-hover"
      data-awake={failure._tag}
    >
      <Coffee class="size-3.5" />
      <span>unprotected</span>
    </a>
  </Tooltip>
{/if}
