<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import History from '@lucide/svelte/icons/history';
  import PanelBottom from '@lucide/svelte/icons/panel-bottom';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Power from '@lucide/svelte/icons/power';
  import Send from '@lucide/svelte/icons/send';
  import Share2 from '@lucide/svelte/icons/share-2';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import { LEAF } from '@tagma/server/graph/contract/wire/tags/leaf';
  import { LAW } from '@tagma/server/graph/contract/wire/tags/lawContracts';
  import type { Delivery } from '@tagma/server/graph/contract/wire/tags/law';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import StatusMenuItems from '$lib/features/graph/StatusMenuItems.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { SessionHandle } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { statusLabel } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
  import { START_WORDS, startable, ThreadWork } from '$lib/features/graph/ThreadWork.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  const tags = TagCatalog.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const work = ThreadWork.use();
  const door = GraphDoor.use();

  let {
    block,
    store,
    author = null,
    linksPlacement,
    rename,
    triggerClass,
    onDeleted,
  }: {
    block: TreeBlock;
    store: TreeScreen;
    author?: SessionHandle | null | undefined;
    linksPlacement?: { readonly beside: boolean; readonly toggle: () => void } | undefined;
    rename?: (() => void) | undefined;
    triggerClass?: string;
    onDeleted?: (parentName: string | null) => void;
  } = $props();

  async function remove(): Promise<void> {
    const { name, parentName } = block;
    if (await store.remove(name)) onDeleted?.(parentName);
  }

  const leaf = $derived(tags.supports(block, LEAF));
  const starts = $derived(startable(tags, block));
  const moves = $derived(tags.actions(block).length > 0);
  const status = $derived(tags.statusOf(block));
  const law = $derived(tags.supports(block, LAW));
  const acting = $derived(rename !== undefined || starts || !leaf || moves || law);
  const opening = $derived(!leaf || linksPlacement !== undefined);

  const BY_SOURCES = 'sources';
  const DELIVERY_CHOICES = [
    { value: BY_SOURCES, label: 'By sources', says: 'Code when it has sources, prompt when it has none' },
    { value: 'prompt', label: 'Prompt', says: 'In every thread’s instructions from the start' },
    { value: 'code', label: 'Code', says: 'When an agent reads or writes the code its sources name' },
  ] as const;
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(
      'grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground',
      triggerClass,
    )}
    aria-label="Block actions"
  >
    <Ellipsis class="size-3.5" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-56" returnFocus={false}>
    {#if acting}
      {#if rename !== undefined}
        <DropdownMenu.Item icon={PencilLine} keys="F2" onSelect={() => rename?.()}>Rename</DropdownMenu.Item>
      {/if}
      {#if starts}
        <DropdownMenu.Item icon={Play} onSelect={() => void work.start({ name: block.name, title: block.title, copy: door.aim })}>
          {START_WORDS}
        </DropdownMenu.Item>
      {/if}
      {#if !leaf}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={Plus}>Add child</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="min-w-40">
            {#each tags.titleOnly as tag (tag)}
              <DropdownMenu.Item onSelect={() => store.createChild(block.name, tag)}>
                {#snippet lead()}<TagIcon {tag} class="size-3.5" />{/snippet}
                <span class="capitalize">{tag}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/if}
      {#if moves}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={Square} current={status === null ? null : statusLabel(status)}>State</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="min-w-44">
            <StatusMenuItems {block} {store} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/if}
      {#if law}
        {@const off = tags.switchedOff(block)}
        {@const delivered = tags.deliveredBy(block)}
        {@const delivery = delivered.stated ?? BY_SOURCES}
        <DropdownMenu.Item icon={Power} onSelect={() => void store.setLawEnabled(block.name, off)}>
          {off ? 'Switch on' : 'Switch off'}
        </DropdownMenu.Item>
        {#if delivered.settable}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger icon={Send} current={DELIVERY_CHOICES.find((choice) => choice.value === delivery)?.label}>
              Delivery
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent class="min-w-40">
              <DropdownMenu.RadioGroup
                value={delivery}
                onValueChange={(next) => void store.setLawDelivery(block.name, next === BY_SOURCES ? null : (next as Delivery))}
              >
                {#each DELIVERY_CHOICES as choice (choice.value)}
                  <DropdownMenu.RadioItem value={choice.value} title={choice.says}>{choice.label}</DropdownMenu.RadioItem>
                {/each}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        {/if}
      {/if}
      <DropdownMenu.Separator />
    {/if}
    {#if opening}
      {#if !leaf}
        <DropdownMenu.Item icon={Share2} onSelect={() => void router.goto(addresses.scoped('graph', block.name))}>
          Open in graph
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={History} onSelect={() => void router.goto(addresses.scoped('journal', block.name))}>
          Open in journal
        </DropdownMenu.Item>
      {/if}
      {#if linksPlacement !== undefined}
        {@const placement = linksPlacement}
        <DropdownMenu.Item icon={placement.beside ? PanelBottom : PanelRight} onSelect={() => placement.toggle()}>
          {placement.beside ? 'Show links below' : 'Show links beside'}
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item icon={Copy} hint={block.name} onSelect={() => navigator.clipboard.writeText(block.name)}>Copy name</DropdownMenu.Item
    >
    <DropdownMenu.Separator />
    <DropdownMenu.Item variant="destructive" icon={Trash2} onSelect={() => void remove()}>Delete</DropdownMenu.Item>
    {#if author !== null}
      <DropdownMenu.Separator />
      <DropdownMenu.Note>Created by <WriterBadge writer={author} /></DropdownMenu.Note>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
