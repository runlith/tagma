<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Copy from '@lucide/svelte/icons/copy';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { messageTime } from './chatTime';
  import { clipFade } from './clipFade';
  import ClampedText from './entries/ClampedText.svelte';
  import CopyAddress from './entries/CopyAddress.svelte';
  import { type FailureFact, failureReport } from './failureFacts';
  import RailRow from './RailRow.svelte';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';

  type Props = {
    id: string;
    label: string;
    text?: string | null;
    notes?: readonly string[];
    facts?: readonly FailureFact[];
    raw?: string | null;
    occurredAt?: string | undefined;
    actions?: Snippet;
  };

  let { id, label, text = null, notes = [], facts = [], raw = null, occurredAt, actions }: Props = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const ACT =
    'inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground';

  const time = $derived(occurredAt ? messageTime(occurredAt, strings.locale) : null);
  const said = $derived(text !== null && text.trim() !== '' ? text : null);
  const reportKey = $derived(`${id}:report`);
  const detailsKey = $derived(`${id}:details`);
  const detailed = $derived(context.verbose && (facts.length > 0 || raw !== null));
  const open = $derived(detailed && context.expanded(detailsKey));
</script>

<RailRow dot="bg-chat-failure">
  <div class="grid min-w-0 gap-1.5" data-failure={id}>
    <div class="flex min-w-0 items-baseline gap-3 text-ui">
      <span class="min-w-0 font-medium text-chat-failure" data-fade {@attach clipFade}>{label}</span>
      {#if time !== null}<span class="shrink-0 font-mono text-meta text-muted-foreground">{time}</span>{/if}
    </div>

    {#if said !== null}
      <ClampedText text={said} id={`${id}:said`} prose copy={false} />
    {/if}

    {#each notes as note, index (index)}
      <p class="text-small break-words text-muted-foreground">{note}</p>
    {/each}

    <div class="-ml-0.5 flex flex-wrap items-center gap-1">
      {@render actions?.()}
      <button
        type="button"
        class={ACT}
        onclick={() => context.copy(reportKey, failureReport({ label, text: said, notes, facts, raw, time }))}
      >
        {#if context.copied(reportKey)}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}{strings.copyReport()}
      </button>
      {#if detailed}
        <button type="button" class={ACT} aria-expanded={open} onclick={() => context.setExpanded(detailsKey, !open)}>
          {strings.details()}<ChevronRight class={['size-3 transition-transform', open && 'rotate-90']} />
        </button>
      {/if}
    </div>

    {#if open}
      <div class="mt-1 grid min-w-0 gap-2 border-t border-border/60 pt-2" transition:slide={{ duration: 160 }}>
        {#if facts.length > 0}
          <dl class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 text-small">
            {#each facts as fact (fact.label)}
              <dt class="text-muted-foreground">{fact.label}</dt>
              <dd class="flex min-w-0 items-center gap-1.5">
                <span class={['min-w-0 text-foreground', fact.mono && 'font-mono text-meta']} data-fade {@attach clipFade}
                  >{fact.value}</span
                >
                {#if fact.note !== undefined}<span class="min-w-0 text-muted-foreground" data-fade {@attach clipFade}>{fact.note}</span
                  >{/if}
                {#if fact.copy}<CopyAddress address={fact.value} {context} id={`${id}:${fact.label}`} />{/if}
              </dd>
            {/each}
          </dl>
        {/if}
        {#if raw !== null}
          <ClampedText text={raw} id={`${id}:raw`} code copy={false} />
        {/if}
      </div>
    {/if}
  </div>
</RailRow>
