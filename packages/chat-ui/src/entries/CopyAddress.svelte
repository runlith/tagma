<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';

  let { address, context, id }: { address: string; context: ChatEntryContext; id: string } = $props();

  const strings = useChatStrings();
  const key = $derived(`${id}:address`);
</script>

<button
  type="button"
  class="inline-flex shrink-0 cursor-pointer items-center text-muted-foreground/40 transition hover:text-muted-foreground"
  aria-label={strings.copyAddress()}
  title={strings.copyAddress()}
  onclick={() => context.copy(key, address)}
>
  {#if context.copied(key)}
    <Check class="size-3 text-chat-mutation" />
  {:else}
    <Copy class="size-3" />
  {/if}
</button>
