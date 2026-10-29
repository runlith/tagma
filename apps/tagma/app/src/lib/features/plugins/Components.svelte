<script lang="ts">
  import type { PluginComponent, PluginComponentKind, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { KINDS } from '$lib/features/plugins/words.js';

  let { components, ignored }: { components: readonly PluginComponent[]; ignored: PluginRow['ignored'] } = $props();

  const taken = $derived(
    (Object.keys(KINDS) as PluginComponentKind[]).flatMap((kind) => {
      const items = components.filter((component) => component.kind === kind);
      return items.length === 0 ? [] : [{ kind, title: KINDS[kind], items }];
    }),
  );
</script>

{#if taken.length > 0}
  <div class="grid gap-3 border-t border-border px-3 py-3">
    <p class="text-small text-muted-foreground">Taken</p>
    {#each taken as group (group.kind)}
      <div class="grid gap-0.5">
        <p class="text-ui font-medium">{group.title}</p>
        {#each group.items as item, index (index)}
          <div class="flex min-w-0 items-baseline gap-2">
            <FadeText text={item.name} class="stamp max-w-full shrink-0" />
            {#if item.detail !== undefined}
              <FadeText text={item.detail} class="text-small text-muted-foreground" />
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

{#if ignored.length > 0}
  <div class="grid gap-1 border-t border-border px-3 py-3">
    <p class="text-small text-muted-foreground">Ignored</p>
    {#each ignored as item, index (index)}
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span class="text-ui">{item.component}</span>
        {#if item.name !== null}<code class="stamp">{item.name}</code>{/if}
        <span class="text-small text-muted-foreground">{item.reason}</span>
      </div>
    {/each}
  </div>
{/if}
