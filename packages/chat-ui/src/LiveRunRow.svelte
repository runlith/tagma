<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import { liveMark, type RailPlace } from './activity';
  import { messageTime } from './chatTime';
  import { clipFade } from './clipFade';
  import { type ChatLiveStatus, chatLiveLine } from './liveStatus';
  import LiveLabel from './LiveLabel.svelte';
  import RailRow from './RailRow.svelte';
  import { useChatRendering } from './renderers';
  import PhaseClock from './PhaseClock.svelte';
  import { useChatStrings } from './strings';
  let {
    status,
    place = 'only',
  }: {
    status: ChatLiveStatus;
    place?: RailPlace;
  } = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
  const COPY_KEY = 'live-run:details';
  const phrase = $derived(strings.livePhase(status.phase, status.waiting));
  const line = $derived(chatLiveLine(status, strings));
  const asOf = $derived(status.asOf === null ? null : strings.feedAsOf(messageTime(status.asOf, strings.locale)));
  const details = $derived(
    status.reason === null
      ? null
      : [phrase, status.reason, ...(status.asOf === null ? [] : [new Date(status.asOf).toISOString()])].join('\n'),
  );
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  <RailRow {place} dot={liveMark(status.pulse)}>
    <div class="flex flex-wrap items-baseline gap-x-2 text-ui text-muted-foreground" data-live-run>
      <LiveLabel active={status.pulse} text={line.lead} />
      {#if line.subject !== null}
        <span class="min-w-0 max-w-full text-foreground/80" data-fade {@attach clipFade}>{line.subject}</span>
      {/if}
      <PhaseClock {status} />
      {#if asOf !== null}
        <span class="shrink-0 text-small text-muted-foreground/55">· {asOf}</span>
      {/if}
      {#if details !== null}
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center gap-1 text-small text-muted-foreground/70 transition hover:text-foreground"
          onclick={() => rendering.context.copy(COPY_KEY, details)}
        >
          {#if rendering.context.copied(COPY_KEY)}<Check class="size-3 text-chat-mutation" />{:else}<Copy class="size-3" />{/if}
          {strings.copyDetails()}
        </button>
      {/if}
    </div>
  </RailRow>
</div>
