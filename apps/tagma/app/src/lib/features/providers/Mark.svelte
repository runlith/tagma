<script lang="ts">
  import InlineSvg from '$lib/shared/ui/InlineSvg.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ProviderCatalog } from './Catalog.svelte.js';

  let {
    provider,
    class: className = '',
    style = '',
    titled = true,
  }: {
    provider: string;
    class?: string;
    style?: string;
    titled?: boolean;
  } = $props();

  const catalog = ProviderCatalog.use();

  const mark = $derived(catalog.provider(provider)?.icon ?? null);
  const label = $derived(catalog.label(provider));
</script>

{#if mark !== null}
  <Tooltip text={titled ? label : undefined}>
    <InlineSvg svg={mark} {label} class={className} {style} />
  </Tooltip>
{:else}
  <Tooltip text={titled ? label : undefined}>
    <span
      class="inline-grid shrink-0 place-items-center overflow-hidden rounded-sm border border-current/40 font-semibold leading-none {className}"
      {style}
      role="img"
      aria-label={label}
    >
      <span class="text-meta">{label.slice(0, 1)}</span>
    </span>
  </Tooltip>
{/if}
