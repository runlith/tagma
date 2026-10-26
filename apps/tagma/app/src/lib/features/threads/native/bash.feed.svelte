<script lang="ts">
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import CommandToolRow from '../CommandToolRow.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { TranscriptReading } from './TranscriptReading.svelte.js';

  let { kinds, transcript, contributor }: { kinds: EntryKinds; transcript: TranscriptReading; contributor: string } = $props();

  const activity = $derived(transcript.activity);

  $effect.pre(() => kinds.registerTool(contributor, { name: 'bash', render: bashRow }));
</script>

{#snippet bashRow(entry: ChatEntryOf<'tool'>)}
  <CommandToolRow {entry} line={activity.launchedLine(entry)} view={activity.view} />
{/snippet}
