<script lang="ts">
  import type { ChatAnswerSending } from '../entries';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import Waiting from '../Waiting.svelte';
  import UnconfirmedNote from './UnconfirmedNote.svelte';

  let { sending }: { sending: ChatAnswerSending } = $props();
  const rendering = useChatRendering();
  const strings = useChatStrings();
</script>

{#if sending.unconfirmed}
  <UnconfirmedNote onResend={() => rendering.resendTurn(sending.key)} />
{:else}
  <p class="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground">
    <Waiting class="size-3" />
    <span>{strings.sendingAnswer()}</span>
  </p>
{/if}
