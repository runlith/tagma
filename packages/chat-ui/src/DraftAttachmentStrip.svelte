<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import AttachmentThumb from './AttachmentThumb.svelte';
  import { clipFade } from './clipFade';
  import type { ChatDraftFile } from './draftFiles';
  import { type ChatDraftImage, chatDraftImageAttachment } from './draftImages';
  import FileChip from './FileChip.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import { useChatStrings } from './strings';

  type Props = {
    images: readonly ChatDraftImage[];
    files?: readonly ChatDraftFile[];
    onRemove?(id: string): void;
  };

  let { images, files = [], onRemove }: Props = $props();
  const strings = useChatStrings();
  let opened = $state<ChatDraftImage | null>(null);

  function byteSize(size: number): string {
    if (size < 1024) return `${size} B`;
    const number = new Intl.NumberFormat(strings.locale, { maximumFractionDigits: 1 });
    if (size < 1024 * 1024) return `${number.format(size / 1024)} KB`;
    return `${number.format(size / 1024 / 1024)} MB`;
  }
</script>

{#if files.length > 0}
  <div class="flex flex-wrap gap-1.5 pb-1">
    {#each files as file (file.id)}
      <FileChip name={file.filename}>
        <span class="shrink-0 tabular-nums text-muted-foreground">{byteSize(file.size)}</span>
        <button
          type="button"
          class="grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground pointer-coarse:size-6"
          aria-label={strings.removeNamed(file.filename)}
          title={strings.removeNamed(file.filename)}
          onclick={() => onRemove?.(file.id)}
        >
          <X class="size-3" />
        </button>
      </FileChip>
    {/each}
  </div>
{/if}
{#if images.length > 0}
  <div class="flex flex-wrap gap-1.5">
    {#each images as image (image.id)}
      <div class="group relative overflow-hidden rounded-lg border border-border bg-hover">
        <AttachmentThumb attachment={chatDraftImageAttachment(image)} size="tile" framed={false} onOpen={() => (opened = image)} />
        <button
          type="button"
          class="absolute right-1 top-1 grid size-5 cursor-pointer place-items-center rounded-full bg-foreground/85 text-background opacity-0 transition group-hover:opacity-100 pointer-coarse:size-7 pointer-coarse:opacity-100"
          aria-label={strings.removeNamed(image.filename)}
          title={strings.removeNamed(image.filename)}
          onclick={() => onRemove?.(image.id)}
        >
          <X class="size-3" />
        </button>
        <div class="px-2 py-1 text-meta leading-tight">
          <div class="max-w-24 font-semibold text-foreground/85" data-fade {@attach clipFade}>{image.filename}</div>
          <div class="text-muted-foreground">{byteSize(image.size)}</div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<ImageViewer image={opened === null ? null : chatDraftImageAttachment(opened)} onClose={() => (opened = null)} />
