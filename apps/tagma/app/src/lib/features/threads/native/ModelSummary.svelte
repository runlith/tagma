<script lang="ts">
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { ModelSettings } from '../thread/modelSettings.js';

  let { settings }: { settings: ModelSettings } = $props();
</script>

<ProviderMark provider={settings.provider} class="size-3.5 shrink-0" titled={false} />
<span class="flex min-w-0 @min-[22rem]:hidden"><FadeText text={settings.modelShort} /></span>
<span class="hidden min-w-0 @min-[22rem]:flex"><FadeText text={settings.modelLabel} /></span>
{#if settings.reasoning}
  <span class="text-muted-foreground @min-[22rem]:hidden">{settings.reasoningShort}</span>
  <span class="hidden text-muted-foreground @min-[22rem]:inline">{settings.reasoningLabel}</span>
{/if}
