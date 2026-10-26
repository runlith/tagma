<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { slide } from 'svelte/transition';
  import AttachedDocBody from '../AttachedDocBody.svelte';
  import type { ChatAttachedDoc } from '../entries';
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    docKey: string;
    docs: readonly ChatAttachedDoc[];
    context: ChatEntryContext;
  };

  let { docKey, docs, context }: Props = $props();
  const strings = useChatStrings();

  const open = $derived(context.expanded(`${docKey}:docs`));
  const multi = $derived(docs.length > 1);
  const label = $derived(multi ? strings.attached() : `@${docs[0]?.title || strings.documentLowercase()}`);
  const meta = $derived(multi ? strings.documentsCount(docs.length) : null);

  function toggleGroup(): void {
    if (open && multi) {
      for (let index = 0; index < docs.length; index += 1) {
        context.setExpanded(`${docKey}:doc:${index}`, false);
      }
    }
    context.setExpanded(`${docKey}:docs`, !open);
  }
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  <button
    type="button"
    class="flex max-w-full cursor-pointer items-center gap-1.5 text-ui text-muted-foreground transition hover:text-foreground"
    aria-expanded={open}
    onclick={toggleGroup}
  >
    <ChevronRight class={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`} />
    <span class="min-w-0 truncate">{label}</span>
    {#if meta}<span class="shrink-0 text-muted-foreground/60">· {meta}</span>{/if}
  </button>
  {#if open}
    <div transition:slide={{ duration: 160 }}>
      {#if !multi && docs[0]}
        <AttachedDocBody {open} cacheKey={`${docKey}:doc:0`} text={docs[0].text} />
      {:else}
        <div class="mt-1.5 grid gap-0.5 pl-5">
          {#each docs as doc, index (`${docKey}:doc:${index}`)}
            {@const bodyOpen = context.expanded(`${docKey}:doc:${index}`)}
            <div class="min-w-0">
              <button
                type="button"
                class="flex w-full min-w-0 cursor-pointer items-center gap-1.5 py-0.5 text-left text-ui text-muted-foreground transition hover:text-foreground"
                aria-expanded={bodyOpen}
                title={doc.title || strings.document()}
                onclick={() => context.setExpanded(`${docKey}:doc:${index}`, !bodyOpen)}
              >
                <ChevronRight class={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${bodyOpen ? 'rotate-90' : ''}`} />
                <span class="min-w-0 truncate">@{doc.title || strings.document()}</span>
              </button>
              <AttachedDocBody open={bodyOpen} cacheKey={`${docKey}:doc:${index}`} text={doc.text} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
