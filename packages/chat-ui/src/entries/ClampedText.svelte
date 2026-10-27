<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import Clamp from './Clamp.svelte';

  let {
    text,
    id,
    code = false,
    prose = false,
    copy = true,
  }: { text: string; id: string; code?: boolean; prose?: boolean; copy?: boolean } = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const key = $derived(`${id}:text`);
</script>

{#snippet copied()}
  <button
    type="button"
    class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    onclick={() => context.copy(key, text)}
  >
    {#if context.copied(key)}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}{strings.copy()}
  </button>
{/snippet}

<div class={['min-w-0', code && 'rounded-lg bg-chat-sunken px-3 py-2']}>
  <Clamp id={key} lines={3} class={prose ? 'leading-6' : 'leading-5'} actions={copy ? copied : undefined}>
    <pre
      class={[
        'min-w-0 whitespace-pre-wrap break-words select-text',
        code
          ? 'font-mono text-small leading-5 text-foreground'
          : prose
            ? 'font-sans text-body leading-6 text-foreground'
            : 'font-sans text-ui leading-5 text-foreground',
      ]}>{text}</pre>
  </Clamp>
</div>
