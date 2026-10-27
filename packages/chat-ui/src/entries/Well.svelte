<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import type { Snippet } from 'svelte';
  import { useChatRendering } from '../renderers';
  import { WELL_LINES } from '../rowEstimate';
  import { useChatStrings } from '../strings';
  import type { ChatLink } from '../surface';
  import Clamp from './Clamp.svelte';

  let {
    id,
    text = null,
    copy = text,
    open = null,
    lines = WELL_LINES,
    count,
    rows = false,
    children,
  }: {
    id: string;
    text?: string | null;
    copy?: string | null;
    open?: ChatLink | null;
    lines?: number;
    count?: string | null;
    rows?: boolean;
    children?: Snippet;
  } = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const copyKey = $derived(`${id}:copy`);
  const counted = $derived(count !== undefined ? count : text === null ? null : strings.lineCount(text.split('\n').length));
</script>

<div class="group/well relative min-w-0 rounded-lg bg-chat-sunken">
  <Clamp {id} {lines} count={counted} flush={rows} class={[rows ? 'p-1' : 'px-3 py-2', 'leading-5']}>
    {#if text !== null}
      <pre class="min-w-0 font-mono text-small leading-5 whitespace-pre-wrap break-words text-muted-foreground select-text">{text}</pre>
    {:else if children}
      {@render children()}
    {/if}
  </Clamp>
  {#if copy !== null || open !== null}
    <div
      class={[
        'absolute top-1 right-1 flex items-center rounded-md bg-chat-sunken transition-opacity',
        !rendering.touch && 'opacity-0 group-focus-within/well:opacity-100 group-hover/well:opacity-100',
      ]}
    >
      {#if copy !== null}
        <button
          type="button"
          class="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-label={strings.copy()}
          {@attach rendering.tip(() => ({ text: strings.copy() }))}
          onclick={() => context.copy(copyKey, copy ?? '')}
        >
          {#if context.copied(copyKey)}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
        </button>
      {/if}
      {#if open !== null}
        <button
          type="button"
          class="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-label={strings.open()}
          {@attach rendering.tip(() => ({ text: strings.open() }))}
          {@attach rendering.navigation.link(open)}
        >
          <ArrowUpRight class="size-3.5" />
        </button>
      {/if}
    </div>
  {/if}
</div>
