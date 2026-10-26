<script lang="ts">
  import type { WordsWait } from '@runlith/agent/transcript/live';
  import type { Snippet } from 'svelte';
  import type { ComposerHandler } from './composer';
  import Composer from './Composer.svelte';
  import type { ComposerContributions } from './ComposerContributions.svelte';
  import PendingInputDock from './PendingInputDock.svelte';
  import type { PromptHandle } from './PromptHandle.svelte';
  import type { PromptRecall } from './PromptHistory';
  import type { ChatRewindChip, ChatRewindTarget } from './rewind';
  import { type ChatQueuedTurnItem, ownWords } from './session/FeedVerdicts';
  import type { ChatHalt } from './session/TurnCommands.svelte';

  type Props = {
    contributions: ComposerContributions;
    handle: PromptHandle;
    canSend: boolean;
    draft: string;
    queued?: readonly ChatQueuedTurnItem[];
    steers?: readonly ChatQueuedTurnItem[];
    steerable?: boolean;
    wordsWait?: WordsWait | null;
    unqueueingId?: string;
    confirmation?: Snippet;
    onUnqueue(id: string): void;
    onEdit(id: string): void;
    onPromote(id: string): void;
    onDraft(value: string): void;
    onSend(): boolean | void | Promise<boolean> | Promise<void>;
    onStop?(): void;
    onQueue?(): boolean | void | Promise<boolean> | Promise<void>;
    perform(handler: ComposerHandler): void;
    history?: PromptRecall;
    placeholder: string;
    running?: boolean;
    halt?: ChatHalt | null;
    sending?: boolean;
    rewindTargets?: readonly ChatRewindTarget[];
    rewindChip?: ChatRewindChip | null;
  };

  let {
    contributions,
    handle,
    canSend,
    draft,
    queued = [],
    steers = [],
    steerable = true,
    wordsWait = null,
    unqueueingId = undefined,
    confirmation,
    onUnqueue,
    onEdit,
    onPromote,
    onDraft,
    onSend,
    onStop,
    onQueue,
    perform,
    history,
    placeholder,
    running = false,
    halt = null,
    sending = false,
    rewindTargets = [],
    rewindChip = null,
  }: Props = $props();

  let composer: ReturnType<typeof Composer> | undefined = $state();

  export function dismiss(): boolean {
    return composer?.dismiss() ?? false;
  }

  export function escapeToRewind(): boolean {
    return composer?.escapeToRewind() ?? false;
  }

  const dock = $derived(contributions.chips('dock'));
  const newest = $derived(
    [...steers, ...queued]
      .filter((item) => ownWords(item) && item.kind === 'turn' && item.removable)
      .reduce<ChatQueuedTurnItem | null>((last, item) => (last === null || item.at >= last.at ? item : last), null),
  );
</script>

<section>
  <div class="mx-auto grid max-w-3xl gap-2">
    {#each dock as chip (chip.id)}
      {@render chip.body()}
    {/each}

    {#if confirmation}
      {@render confirmation()}
    {/if}

    <PendingInputDock
      {queued}
      {steers}
      {steerable}
      {wordsWait}
      stoppable={halt === 'stop'}
      busyId={unqueueingId}
      {onUnqueue}
      {onEdit}
      {onPromote}
    />

    <Composer
      bind:this={composer}
      {contributions}
      {handle}
      {canSend}
      {draft}
      {placeholder}
      {running}
      {halt}
      {sending}
      {steerable}
      {onDraft}
      {onSend}
      {onStop}
      {onQueue}
      onTakeWaiting={newest === null || unqueueingId !== undefined ? undefined : () => onEdit(newest.id)}
      {perform}
      {history}
      {rewindTargets}
      {rewindChip}
    />
  </div>
</section>
