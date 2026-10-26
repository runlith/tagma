<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { ServedSettings } from '@tagma/server/providers/contract/wire/catalog';
  import { Button } from '$lib/shared/ui/button/index.js';

  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';

  import FieldControl from './FieldControl.svelte';
  import ModelRows from './ModelRows.svelte';
  import { type Draft, draftOf, valuesOf } from './draft.js';

  type Instance = ServedSettings['instances'][number];

  let { settings, instance, onclose }: { settings: ServedSettings; instance: Instance | null; onclose?: () => void } = $props();

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const catalog = ProviderCatalog.use();

  let draft = $state<Draft>(untrack(() => draftOf(settings.fields, instance?.values ?? {})));
  let revision = $state(untrack(() => instance?.revision));

  let open = $state(untrack(() => instance === null));
  let busy = $state<'save' | 'remove' | null>(null);

  const name = $derived(String(instance?.values[settings.name] ?? '') || (instance === null ? `New ${settings.instance}` : instance.id));
  const served = $derived(instance === null ? undefined : catalog.provider(instance.id));

  const models = $derived(served === undefined ? 0 : Object.keys(served.models).length);

  async function act(mark: 'save' | 'remove', work: () => Promise<unknown>): Promise<void> {
    busy = mark;
    try {
      await work();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  const save = () =>
    act('save', async () => {
      const saved = await accounts.saveInstance.run(
        {
          adapter: settings.adapter,
          id: instance?.id,
          revision,
          values: valuesOf(settings.fields, draft),
        },
        { throwOnError: true },
      );

      if (instance === null) onclose?.();
      else if (saved) {
        draft = draftOf(settings.fields, saved.values);
        revision = saved.revision;
      }
    });

  const remove = () =>
    act('remove', async () => {
      if (instance === null) return;
      await accounts.removeInstance.run({ adapter: settings.adapter, id: instance.id }, { throwOnError: true });
    });

  async function discover() {
    try {
      return (
        (await accounts.discoverModels.run(
          {
            adapter: settings.adapter,
            values: valuesOf(settings.fields, draft),
            id: instance?.id,
            revision,
          },
          { throwOnError: true },
        )) ?? null
      );
    } catch (error: unknown) {
      notices.refusal(error);
      return null;
    }
  }
</script>

<section class="overflow-hidden rounded-lg border bg-raised" data-instance={instance?.id ?? 'new'}>
  <h3 class="text-ui font-semibold">
    <button
      type="button"
      class="flex min-h-9 w-full items-center gap-2 px-3 py-1 text-left font-semibold hover:bg-hover"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {#if open}<ChevronDown class="size-3.5 shrink-0" />{:else}<ChevronRight class="size-3.5 shrink-0" />{/if}
      {#if instance !== null}<ProviderMark provider={instance.id} class="size-4 text-foreground" titled={false} />{/if}
      <span class="min-w-0 truncate">{name}</span>
      {#if instance !== null}
        <span class="text-ui font-normal text-muted-foreground"
          >{models === 0 ? 'no models enabled' : models === 1 ? '1 model' : `${models} models`}</span
        >
      {/if}
    </button>
  </h3>

  {#if open}
    <fieldset class="m-0 grid min-w-0 gap-3 border-0 border-t border-solid px-3 py-3" disabled={busy !== null}>
      {#each settings.fields as field (field.id)}
        {#if field.type === 'rows' && field.secret !== true}
          <ModelRows
            {field}
            bind:rows={draft[field.id] as Draft[]}
            discover={field.discoverable === true && settings.discovers ? discover : null}
          />
        {:else}
          <FieldControl {field} bind:value={draft[field.id]} />
        {/if}
      {/each}
      <div class="flex items-center gap-2">
        <Button size="sm" disabled={busy !== null} onclick={() => void save()}
          >{instance === null ? `Add ${settings.instance}` : 'Save'}</Button
        >
        {#if instance === null}
          <Button variant="ghost" size="sm" onclick={() => onclose?.()}>Cancel</Button>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              draft = draftOf(settings.fields, instance.values);
              revision = instance.revision;
            }}>Reload saved values</Button
          >
          <span class="flex-1"></span>
          <Button variant="destructive" size="sm" disabled={busy !== null} onclick={() => void remove()}>Remove {settings.instance}</Button>
        {/if}
      </div>
    </fieldset>
  {/if}
</section>
