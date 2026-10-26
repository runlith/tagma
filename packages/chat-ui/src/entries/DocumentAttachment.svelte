<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import AttachedDocBody from '../AttachedDocBody.svelte';
  import Waiting from '../Waiting.svelte';
  import type { ChatAttachment } from '../entries';
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    docKey: string;
    attachment: ChatAttachment;
    context: ChatEntryContext | undefined;
  };

  let { docKey, attachment, context }: Props = $props();
  const strings = useChatStrings();

  let opened = $state(false);
  const open = $derived(context === undefined ? opened : context.expanded(docKey));
  let text = $state<string | null>(null);
  let failed = $state<string | null>(null);
  const readable = $derived(attachment.url !== '' && context?.readAttachment !== undefined);

  $effect(() => {
    const read = context?.readAttachment;
    if (!open || text !== null || attachment.url === '' || read === undefined) return;
    const url = attachment.url;
    const controller = new AbortController();
    read
      .call(context, url, controller.signal)
      .then((answer) => {
        text = answer;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) failed = error instanceof Error ? error.message : String(error);
      });
    return () => controller.abort();
  });

  function toggle(): void {
    if (context === undefined) opened = !opened;
    else context.setExpanded(docKey, !open);
  }
</script>

<div class="w-full min-w-0">
  <button
    type="button"
    class="ml-auto flex max-w-full cursor-pointer items-center gap-1.5 text-ui text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
    aria-expanded={open}
    disabled={!readable}
    onclick={toggle}
  >
    <ChevronRight class={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`} />
    <span class="min-w-0 truncate">@{attachment.filename ?? strings.document()}</span>
  </button>
  {#if open}
    {#if text !== null}
      <AttachedDocBody {open} cacheKey={docKey} {text} />
    {:else if failed !== null}
      <p class="mt-1 text-small text-destructive">{failed}</p>
    {:else}
      <Waiting class="mt-1 size-3.5 text-muted-foreground" />
    {/if}
  {/if}
</div>
