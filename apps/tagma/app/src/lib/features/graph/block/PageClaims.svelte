<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import { Bar } from '$lib/app/panes/Bar.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Topics } from '$lib/shared/threads/Topics.svelte.js';

  let { read }: { read: BlockRead | null } = $props();

  const topics = Topics.use();
  const bar = Bar.use();
  const tags = TagCatalog.use();

  $effect(() => topics.offer(() => (read === null ? null : { kind: 'block', name: read.name, title: read.title, tag: tags.tagOf(read) })));
  $effect(() => bar.name(() => read?.title ?? null));
</script>
