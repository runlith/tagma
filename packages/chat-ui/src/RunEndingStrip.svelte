<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    tone: 'failure' | 'interrupted';
    text: string;
    detail?: string | null;
    action?: Snippet;
  };

  let { tone, text, detail = null, action }: Props = $props();

  const MARK: Record<Props['tone'], string> = {
    failure: 'bg-chat-failure',
    interrupted: 'bg-chat-interrupted',
  };
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/70 bg-chat-raised py-1.5 pr-1.5 pl-3">
  <span class="size-2 shrink-0 rounded-full {MARK[tone]}" aria-hidden="true"></span>
  <p class="min-w-48 flex-1 truncate text-ui text-foreground" title={detail ? `${text} · ${detail}` : text}>
    {text}{#if detail}<span class="text-muted-foreground"> · {detail}</span>{/if}
  </p>
  {#if action}
    <div class="ml-auto shrink-0">
      {@render action()}
    </div>
  {/if}
</div>
