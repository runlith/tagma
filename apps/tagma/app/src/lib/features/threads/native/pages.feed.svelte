<script lang="ts">
  import { Schema } from 'effect';
  import { PUBLISH_TOOL, type PublishedPage, publishedPageSchema } from '@tagma/server/artifacts/contract/wire/published';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import { type Video, videoSchema } from '@tagma/server/artifacts/contract/wire/artifacts';
  import PageCard from '../../pages/PageCard.svelte';
  import VideoCall from '../../pages/VideoCall.svelte';

  const EXPORT_TOOL = 'export_artifact_video';
  import type { ShownThread } from '../ShownThread.js';

  let { shown, kinds, contributor }: { shown: ShownThread; kinds: EntryKinds; contributor: string } = $props();

  const decoded = Schema.decodeUnknownOption(publishedPageSchema);
  const read = new WeakMap<object, PublishedPage | null>();

  const publishedOf = (entry: ChatEntryOf<'tool'>): PublishedPage | null => {
    const output = entry.toolOutput;
    if (entry.toolState !== 'output-available' || typeof output !== 'object' || output === null) return null;
    const known = read.get(output);
    if (known !== undefined) return known;
    const answer = decoded(output);
    const published = answer._tag === 'Some' ? answer.value : null;
    read.set(output, published);
    return published;
  };

  const exported = Schema.decodeUnknownOption(Schema.Struct({ page: Schema.String, video: videoSchema }));
  const exports = new WeakMap<object, { readonly page: string; readonly video: Video } | null>();

  const exportOf = (entry: ChatEntryOf<'tool'>): { readonly page: string; readonly video: Video } | null => {
    const output = entry.toolOutput;
    if (entry.toolState !== 'output-available' || typeof output !== 'object' || output === null) return null;
    const known = exports.get(output);
    if (known !== undefined) return known;
    const answer = exported(output);
    const found = answer._tag === 'Some' ? answer.value : null;
    exports.set(output, found);
    return found;
  };

  $effect.pre(() => kinds.registerTool(contributor, { name: PUBLISH_TOOL, view: card, renders: (entry) => publishedOf(entry) !== null }));
  $effect.pre(() => kinds.registerTool(contributor, { name: EXPORT_TOOL, view: film, renders: (entry) => exportOf(entry) !== null }));
</script>

{#snippet film(entry: ChatEntryOf<'tool'>)}
  {@const found = exportOf(entry)}
  {#if found !== null}
    <VideoCall page={found.page} answered={found.video} />
  {/if}
{/snippet}

{#snippet card(entry: ChatEntryOf<'tool'>)}
  {@const published = publishedOf(entry)}
  {#if published !== null}
    <PageCard {published} thread={shown.id} />
  {/if}
{/snippet}
