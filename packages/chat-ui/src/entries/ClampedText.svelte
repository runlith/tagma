<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import { clampFade } from '../clipFade';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

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
  const all = $derived(context.expanded(`${key}:all`));
  let clipped = $state(false);
</script>

<div class="grid min-w-0 gap-1">
  <div class={['min-w-0', code && 'rounded-lg bg-chat-sunken px-3 py-2']}>
    <pre
      class={[
        'min-w-0 whitespace-pre-wrap break-words select-text',
        code
          ? 'font-mono text-small leading-5 text-foreground'
          : prose
            ? 'font-sans text-body leading-6 text-foreground'
            : 'font-sans text-ui leading-5 text-foreground',
        !all && 'clamp',
      ]}
      data-clamp={all ? undefined : ''}
      {@attach all ? undefined : clampFade((value) => (clipped = value))}>{text}</pre>
  </div>
  {#if copy || clipped || all}
    <div class="-ml-1.5 flex items-center gap-1">
      {#if clipped || all}
        <button
          type="button"
          class="cursor-pointer rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-expanded={all}
          onclick={() => context.setExpanded(`${key}:all`, !all)}>{all ? strings.showLess() : strings.showAll()}</button
        >
      {/if}
      {#if copy}
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          onclick={() => context.copy(key, text)}
        >
          {#if context.copied(key)}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}{strings.copy()}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .clamp {
    max-height: 3lh;
  }
</style>
