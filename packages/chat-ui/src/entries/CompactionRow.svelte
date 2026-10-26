<script lang="ts">
  import { chatCompactionFacts, chatCompactionLabel, chatCompactionMark, shownFacts } from '../activity';
  import { clipFade } from '../clipFade';
  import RailRow from '../RailRow.svelte';
  import { type ChatEntryOf, useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    entry: ChatEntryOf<'compaction'>;
  };

  let { entry }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
  const label = $derived(chatCompactionLabel(entry, strings, rendering.kinds.identity(entry)?.title ?? null));
  const facts = $derived(shownFacts([...chatCompactionFacts(entry, strings), ...rendering.kinds.facts(entry)], rendering.context.verbose));
</script>

<div data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <RailRow dot={chatCompactionMark(entry)}>
    <div class="flex min-w-0 items-baseline gap-x-3 overflow-hidden text-ui whitespace-nowrap">
      <span class="min-w-0 text-muted-foreground/60" data-fade {@attach clipFade}>{label}</span>
      {#each facts as fact, index (index)}
        <span class="shrink-0 font-mono text-meta text-muted-foreground/60">
          {fact.label}{#if fact.value !== undefined}&nbsp;<span class="text-muted-foreground/90">{fact.value}</span>{/if}
        </span>
      {/each}
    </div>
  </RailRow>
</div>
