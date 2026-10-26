<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import ModelCatalogList from '$lib/features/providers/models/CatalogList.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { choiceKey, type ModelChoice, windowWord } from '$lib/shared/models/choice.js';
  import { modelContextWindow } from '@runlith/llm/models/description';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';

  import * as Popover from '$lib/shared/ui/popover/index.js';

  let {
    label,
    provider,
    model,
    disabled = false,
    onpick,
  }: {
    label: string;
    provider: string;
    model: string;
    disabled?: boolean;
    onpick: (provider: string, model: string) => void;
  } = $props();

  let open = $state(false);

  const catalog = ProviderCatalog.use();

  const choices = $derived<readonly ModelChoice[]>(
    catalog.models.providerOptions
      .filter((option) => catalog.provider(option.id)?.selectable !== false)
      .flatMap((option) =>
        catalog.models.modelsFor(option.id, 'text').map((row) => ({
          provider: option.id,
          providerLabel: option.label,
          model: row.id,
          label: row.label,
          short: row.short,
          ladder: [],
          rung: null,
          meta: windowWord(modelContextWindow(row.capacity)),
        })),
      ),
  );

  const current = $derived(choiceKey(provider, model));
  const chosen = $derived(choices.find((row) => row.provider === provider && row.model === model) ?? null);
  const inCatalog = $derived(chosen !== null || (provider === '' && model === ''));

  const PILL =
    'inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 rounded-full bg-hover px-2 text-small font-semibold text-foreground/85 hover:bg-hover hover:text-foreground disabled:opacity-60';
</script>

<Popover.Root bind:open>
  <Popover.Trigger class={PILL} aria-label={label} {disabled}>
    <ProviderMark {provider} class="size-3.5 shrink-0" titled={false} />
    <FadeText class="min-w-0">{chosen?.label ?? (model === '' ? 'Pick a model' : model)}</FadeText>
    {#if chosen}
      <span class="shrink-0 font-mono text-meta text-muted-foreground">{chosen.meta}</span>
    {/if}
    <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-96 gap-0 rounded-lg p-0">
    {#if !inCatalog}
      <div class="border-b border-border px-3 py-2 text-small text-severity-gap">
        {provider} · {model} is not in this catalog
      </div>
    {/if}
    <ModelCatalogList
      {choices}
      {current}
      onpick={(next) => {
        open = false;
        onpick(next.provider, next.model);
      }}
      onclose={() => (open = false)}
    />
  </Popover.Content>
</Popover.Root>
