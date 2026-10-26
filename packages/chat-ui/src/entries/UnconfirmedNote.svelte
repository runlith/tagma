<script lang="ts">
  import { useChatStrings } from '../strings';

  let { onResend, onForget }: { onResend: () => void; onForget?: () => void } = $props();
  const strings = useChatStrings();
</script>

<div class="mt-1 flex items-center gap-2 text-meta text-muted-foreground">
  <span>{strings.unconfirmedTurn()}</span>
  <button type="button" class="rounded-sm px-1 text-foreground hover:bg-hover" onclick={onResend}>
    {strings.resendTurn()}
  </button>
  {#if onForget !== undefined}
    <button type="button" class="rounded-sm px-1 text-foreground hover:bg-hover" onclick={onForget}>
      {strings.forgetTurn()}
    </button>
  {/if}
</div>
