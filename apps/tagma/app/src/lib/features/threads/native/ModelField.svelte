<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import ModelCatalogList from '$lib/features/providers/models/CatalogList.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import type { ModelFieldProps } from '$lib/features/settings/controls/modelField.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { choiceKey } from '$lib/shared/models/choice.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { Favorites } from '../Favorites.svelte.js';
  import { fieldModels } from './fieldModels.js';

  let { label, value, ask, chip = false, blank = 'Pick a model', disabled = false, onpick, onautomatic }: ModelFieldProps = $props();

  let open = $state(false);

  const catalog = ProviderCatalog.use();
  const favorites = Favorites.use();

  const list = $derived(fieldModels(catalog.models, ask, value, favorites.list));
  const current = $derived(value === null ? null : choiceKey(value.provider, value.model));
  const chosen = $derived(list.choices.find((row) => choiceKey(row.provider, row.model) === current) ?? null);
  const rung = $derived(chosen === null ? null : (chosen.ladder.find((step) => step.id === chosen.rung) ?? null));
  const empty = $derived(
    `Nothing installed here answers ${ask ?? 'text'} asks: connect a provider by API key or subscription, or add a CLI whose adapter declares an ask program.`,
  );

  const TRIGGER = $derived(
    chip
      ? 'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-small font-medium transition-colors hover:bg-hover disabled:opacity-50 data-[state=open]:bg-selected'
      : 'inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 rounded-full bg-hover px-2 text-small font-semibold text-foreground/85 hover:bg-hover hover:text-foreground disabled:opacity-60',
  );
</script>

<Popover.Root bind:open>
  <Popover.Trigger class={TRIGGER} aria-label={label} {disabled}>
    {#if value !== null}
      <ProviderMark provider={value.provider} class="size-3.5 shrink-0" titled={false} />
    {/if}
    <FadeText class={['min-w-0', value === null && 'text-muted-foreground']}
      >{chosen?.label ?? (value === null ? blank : `${value.provider}:${value.model}`)}</FadeText
    >
    {#if rung !== null}
      <span class="shrink-0 text-muted-foreground">{rung.label}</span>
    {/if}
    <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-96 gap-0 rounded-lg p-0">
    {#if value !== null && chosen === null}
      <div class="border-b border-border px-3 py-2 text-small text-severity-gap">
        {value.provider}:{value.model} is not among the models that answer {ask ?? 'text'} here
      </div>
    {/if}
    {#if onautomatic !== undefined}
      <div class="border-b border-border p-1">
        <button
          type="button"
          class={[
            'flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui hover:bg-hover',
            value === null && 'bg-selected',
          ]}
          aria-pressed={value === null}
          onclick={() => {
            open = false;
            onautomatic();
          }}
        >
          {#if value === null}
            <span class="size-1.5 shrink-0 bg-brand" aria-label="Current choice"></span>
          {:else}
            <span class="w-1.5 shrink-0"></span>
          {/if}
          <span class="font-medium">{blank}</span>
          <span class="min-w-0 text-small text-muted-foreground">chosen when asked</span>
        </button>
      </div>
    {/if}
    <ModelCatalogList
      choices={list.choices}
      lead={list.lead}
      {current}
      starred={list.starred}
      {empty}
      onpick={(next, step) => {
        open = false;
        onpick({ provider: next.provider, model: next.model, reasoning: step });
      }}
      onstar={(provider, model) => void favorites.toggle(provider, model)}
      onreorder={(moved, before) => void favorites.move(moved, before)}
      onclose={() => (open = false)}
    />
  </Popover.Content>
</Popover.Root>
