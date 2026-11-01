<script lang="ts">
  import Blocks from '@lucide/svelte/icons/blocks';
  import { Schema } from 'effect';
  import type { CatalogOperationId } from '$lib/wire/operation.js';
  import { PLUGIN_LINK, type PluginLinkTarget } from '@tagma/server/plugins/contract/wire/link';
  import { type PluginRow, pluginRowSchema } from '@tagma/server/plugins/contract/wire/rows';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import Well from '@runlith/chat-ui/entries/Well.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import type { Link } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { ShownThread } from '../ShownThread.js';

  let { shown, kinds, contributor }: { shown: ShownThread; kinds: EntryKinds; contributor: string } = $props();

  const opening = Opening.use();
  const here = App.current();

  const decoded = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Literal('ok'), plugin: pluginRowSchema }));
  const read = new WeakMap<object, PluginRow | null>();

  const installed = (entry: ChatEntryOf<'tool'>): PluginRow | null => {
    const output = entry.toolOutput;
    if (entry.toolState !== 'output-available' || typeof output !== 'object' || output === null) return null;
    const known = read.get(output);
    if (known !== undefined) return known;
    const answer = decoded(output);
    const plugin = answer._tag === 'Some' ? answer.value.plugin : null;
    read.set(output, plugin);
    return plugin;
  };

  const linkOf = (plugin: PluginRow): Link<PluginLinkTarget> => ({
    kind: PLUGIN_LINK,
    target: { projectId: shown.projectId, id: plugin.id },
  });

  $effect.pre(() =>
    kinds.registerTool(contributor, {
      name: 'install_plugin' satisfies CatalogOperationId,
      render: card,
      renders: (entry) => installed(entry) !== null,
      open: true,
    }),
  );
</script>

{#snippet card(entry: ChatEntryOf<'tool'>)}
  {@const plugin = installed(entry)}
  {#if plugin !== null}
    <Well id={entry.id} copy={null} rows>
      <div
        role="link"
        tabindex="0"
        {@attach linkTarget(opening, () => linkOf(plugin), here)}
        class="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-ui transition-colors select-none hover:bg-hover"
        data-plugin-step={plugin.id}
      >
        <Blocks class="size-3.5 shrink-0 text-muted-foreground" />
        <FadeText class="min-w-0 flex-1" text={plugin.title ?? plugin.id} />
        {#if plugin.version !== null}<span class="shrink-0 text-small text-muted-foreground">{plugin.version}</span>{/if}
      </div>
    </Well>
  {/if}
{/snippet}
