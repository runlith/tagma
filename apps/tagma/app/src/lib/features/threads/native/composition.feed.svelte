<script lang="ts">
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { TranscriptReading } from './TranscriptReading.svelte.js';

  let { kinds, transcript, contributor }: { kinds: EntryKinds; transcript: TranscriptReading; contributor: string } = $props();

  $effect.pre(() => kinds.register(contributor, { kind: 'assistant', messageMeta: (entry) => transcript.facts.meta(entry) }));
</script>
