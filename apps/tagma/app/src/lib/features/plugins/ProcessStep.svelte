<script lang="ts">
  import type { PluginProcessRow } from '@tagma/server/plugins/contract/wire/rows';
  import StepMark from '$lib/features/plugins/StepMark.svelte';
  import { failureSplit, processSaid } from '$lib/features/plugins/words.js';

  let { process, here }: { process: PluginProcessRow; here: boolean } = $props();

  const said = $derived(processSaid(process, here));
  const failure = $derived(process.failure === undefined ? null : failureSplit(process.failure));
</script>

<div class="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2" data-process={process.state}>
  <StepMark tone={said.tone} />
  <span class="grid min-w-0 gap-0.5">
    <span class={['text-ui font-medium', process.state === 'stopped' && 'text-muted-foreground']}>{said.title}</span>
    {#if said.detail !== null}<span class="text-small text-muted-foreground">{said.detail}</span>{/if}
    {#if failure !== null && failure.reason !== ''}<span class="text-small text-muted-foreground">{failure.reason}</span>{/if}
    {#if failure !== null && failure.output !== ''}
      <details class="text-small text-muted-foreground">
        <summary class="cursor-pointer">What it printed</summary>
        <pre class="stamp pt-1 break-words whitespace-pre-wrap">{failure.output}</pre>
      </details>
    {/if}
  </span>
</div>
