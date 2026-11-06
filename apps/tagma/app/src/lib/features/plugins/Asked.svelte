<script lang="ts">
  let {
    hours,
    asks,
    unanswered,
    inputTokens,
    outputTokens,
  }: {
    hours: number;
    asks: number;
    unanswered: number;
    inputTokens: number;
    outputTokens: number;
  } = $props();

  const tokens = (count: number) => count.toLocaleString('en-US');
  const period = $derived(hours === 1 ? 'the last hour' : `the last ${tokens(hours)} hours`);
</script>

{#if asks > 0}
  <section class="grid gap-2" aria-label="Its asks to a model">
    <h3 class="text-small font-medium text-muted-foreground">Asks to a model</h3>
    <div class="grid gap-0.5 rounded-lg border bg-raised px-3 py-2">
      <span class="text-ui">{asks === 1 ? 'Asked once' : `Asked ${tokens(asks)} times`} in {period}</span>
      <span class="text-small text-muted-foreground">
        {tokens(inputTokens)} tokens read, {tokens(outputTokens)} written{unanswered === 0 ? '' : `, ${tokens(unanswered)} unanswered`}
      </span>
    </div>
  </section>
{/if}
