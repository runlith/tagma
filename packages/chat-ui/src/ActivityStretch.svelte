<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { type ActivityGroup, groupDurationSeconds, groupFailureCount } from './activity';
  import { elapsedDuration } from './chatTime';
  import { clipFade } from './clipFade';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';

  type Props = {
    group: ActivityGroup;
    thoughts?: boolean;
    newest?: boolean;
    growing?: boolean;
  };

  let { group, thoughts = false, newest = false, growing = false }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const open = $derived(context.expanded(group.key, context.stretchDefault(group.key, newest)));
  const failureCount = $derived(groupFailureCount(group));
  const durationSeconds = $derived(growing ? null : groupDurationSeconds(group));
  const workedLabel = $derived(durationSeconds === null ? strings.worked() : strings.workedFor(elapsedDuration(durationSeconds * 1000)));
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  <button
    type="button"
    class="group/worked flex max-w-full cursor-pointer items-baseline gap-x-3 py-0.5 text-ui text-muted-foreground/70 transition hover:text-foreground"
    aria-expanded={open}
    onclick={() => context.setExpanded(group.key, !open)}
  >
    <span class="flex min-w-0 items-baseline gap-1.5">
      <ChevronRight
        class={`size-3 shrink-0 translate-y-0.5 text-muted-foreground/40 transition-transform group-hover/worked:text-muted-foreground ${open ? 'rotate-90' : ''}`}
      />
      <span class="min-w-0" data-fade {@attach clipFade}>{thoughts ? strings.thoughtsCount(group.entries.length) : workedLabel}</span>
    </span>
    {#if !thoughts}<span class="shrink-0 text-muted-foreground/45">{strings.stepsCount(group.entries.length)}</span>{/if}
    {#if failureCount > 0}<span class="shrink-0 text-chat-failure/90">{strings.failedCount(failureCount)}</span>{/if}
  </button>
</div>
