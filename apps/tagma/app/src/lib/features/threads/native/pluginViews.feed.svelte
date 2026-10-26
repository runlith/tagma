<script lang="ts">
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import PluginView from '../../plugins/PluginView.svelte';
  import { ViewSets } from '../../plugins/ViewSets.svelte.js';
  import type { ShownThread } from '../ShownThread.js';

  let { shown, kinds, contributor }: { shown: ShownThread; kinds: EntryKinds; contributor: string } = $props();

  const sets = ViewSets.use();

  const results = $derived(
    new Map(
      sets.sets.flatMap((set) => {
        const live = new Set(set.views.filter((view) => view.live === true).map((view) => view.id));
        return set.results.map((result) => [result.name, { plugin: set.plugin, view: result.view, live: live.has(result.view) }] as const);
      }),
    ),
  );

  $effect.pre(() => {
    const releases = [...results].map(([name, result]) =>
      kinds.registerTool(contributor, { name, view: resultView, keepAlive: result.live ? (true as const) : undefined }),
    );
    return () => {
      for (const release of releases) release();
    };
  });
</script>

{#snippet resultView(entry: ChatEntryOf<'tool'>)}
  {@const result = results.get(entry.toolName)}
  {#if result !== undefined}
    <PluginView plugin={result.plugin} view={result.view} projectId={shown.projectId} threadId={shown.id} {entry} />
  {/if}
{/snippet}
