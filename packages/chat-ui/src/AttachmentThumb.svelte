<script lang="ts">
  import type { ChatAttachment } from './entries';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';

  type Props = {
    attachment: ChatAttachment;
    size: 'row' | 'tile' | 'feed' | 'full';
    href?: string;
    framed?: boolean;
    onOpen(event: MouseEvent): void;
  };

  let { attachment, size, href, framed = true, onOpen }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();

  const FRAME = {
    row: 'size-6 rounded-sm border border-border',
    tile: 'rounded-lg border border-border',
    feed: 'rounded-lg border border-border/70 bg-background/40',
    full: 'rounded-lg border border-border/70 bg-background/40',
  } as const;
  const PICTURE = {
    row: 'size-full object-cover',
    tile: 'size-16 object-cover',
    feed: 'size-24 object-cover',
    full: 'max-h-96 w-auto max-w-full object-contain',
  } as const;

  const name = $derived(attachment.filename ?? strings.image());
  const frame = $derived(['block cursor-zoom-in overflow-hidden', size === 'row' && 'shrink-0', framed && FRAME[size]]);

  function menu(event: MouseEvent): void {
    const open = rendering.navigation.imageMenu;
    if (open === undefined) return;
    event.preventDefault();
    open(attachment, { x: event.clientX, y: event.clientY }, null);
  }
</script>

{#snippet picture()}
  <img src={attachment.url} alt={attachment.filename ?? strings.attachment()} class={['block', PICTURE[size]]} />
{/snippet}

{#if href === undefined}
  <button type="button" class={frame} title={name} onclick={onOpen} oncontextmenu={menu}>{@render picture()}</button>
{:else}
  <a {href} target="_blank" rel="noopener" class={frame} title={name} onclick={onOpen} oncontextmenu={menu}>{@render picture()}</a>
{/if}
