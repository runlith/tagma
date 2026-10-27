<script lang="ts">
  import type { ChatEntryOf, ChatToolStatus } from '@runlith/chat-ui/renderers';
  import { CallActivity } from '../CallActivity.svelte.js';
  import CallControls from '../CallControls.svelte';
  import CallStatus from '../CallStatus.svelte';
  import CommandActs from '../CommandActs.svelte';
  import CommandMark, { commandDot } from '../CommandMark.svelte';
  import CommandSheet from '../CommandSheet.svelte';
  import CommandStatus from '../CommandStatus.svelte';
  import EndedCallStatus from '../EndedCallStatus.svelte';
  import WaitStatus from '../WaitStatus.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { TranscriptReading } from './TranscriptReading.svelte.js';

  let {
    shown,
    kinds,
    transcript,
    contributor,
  }: { shown: ShownThread; kinds: EntryKinds; transcript: TranscriptReading; contributor: string } = $props();

  const calls = CallActivity.use();
  const readings = Readings.use();
  const activity = $derived(transcript.activity);

  const status: ChatToolStatus = {
    held: (entry) => {
      if (activity.launchedLine(entry) !== null) return 'marked';
      const awaited = activity.awaited(entry);
      if (awaited !== null && awaited.budgetMs !== null) return 'status';
      return activity.ended(entry) !== null ? 'status' : null;
    },
    dot: (entry) => {
      const line = activity.launchedLine(entry);
      return line === null || activity.view === null ? null : commandDot(line, activity.view);
    },
    mark: commandMark,
    status: commandStatus,
    detail: targetDetail,
  };

  $effect.pre(() =>
    kinds.register(contributor, { kind: 'tool', actions: callActions, identity: (entry) => activity.identity(entry), status }),
  );
</script>

{#snippet commandMark(_entry: ChatEntryOf<'tool'>)}
  <CommandMark />
{/snippet}

{#snippet commandStatus(entry: ChatEntryOf<'tool'>)}
  {@const line = activity.launchedLine(entry)}
  {#if line !== null && activity.view !== null}
    {@const call = calls.callAt(shown.id, entry.runId, entry.toolCallId)}
    <CommandStatus
      {line}
      view={activity.view}
      held={call !== null && call.mode === 'foreground' && call.endedAt === null}
      adjustable
      load={readings.execution(line.owner.thread, line.key)?.execution ?? null}
    />
  {:else}
    {@const awaited = activity.awaited(entry)}
    {@const ended = awaited === null || awaited.budgetMs === null ? activity.ended(entry) : null}
    {#if awaited !== null && awaited.budgetMs !== null}
      <WaitStatus admittedAt={awaited.admittedAt} budgetMs={awaited.budgetMs} />
      {#if awaited.target !== null}
        <CallStatus call={awaited.target} />
      {/if}
    {:else if ended !== null}
      <EndedCallStatus call={ended.call} line={ended.line} />
    {/if}
  {/if}
{/snippet}

{#snippet targetDetail(entry: ChatEntryOf<'tool'>)}
  {@const awaited = activity.awaited(entry)}
  {#if awaited !== null && awaited.line !== null && activity.view !== null}
    <CommandSheet line={awaited.line} view={activity.view} call={awaited.call} budgetMs={awaited.budgetMs} />
  {/if}
{/snippet}

{#snippet callActions(entry: ChatEntryOf<'tool'>)}
  {@const line = activity.launchedLine(entry)}
  {#if line !== null && activity.view !== null}
    <CommandActs {line} view={activity.view} life={false} />
  {:else}
    {@const awaited = activity.awaited(entry)}
    {@const call = calls.callAt(shown.id, entry.runId, entry.toolCallId)}
    {#if call !== null}
      <CallControls {call} awaited={awaited !== null && awaited.budgetMs !== null} />
    {/if}
  {/if}
{/snippet}
