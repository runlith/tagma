<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';

  type Outcome = 'done' | 'pending' | 'failed';

  let {
    outcome,
    verb,
    row,
    name,
    absent = null,
    tail,
    children,
    ...rest
  }: {
    outcome: Outcome;
    verb: string;
    row: WorktreePlace | null;
    name: string;
    absent?: string | null;
    tail?: Snippet;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'children'> = $props();
</script>

<div {...rest} class="my-1 grid max-w-xl gap-1 rounded-lg border bg-raised px-3 py-2 text-ui">
  <div class="flex min-w-0 items-center gap-2">
    <span class="grid size-3.5 shrink-0 place-items-center">
      {#if outcome === 'pending'}
        <Waiting class="size-3.5 text-muted-foreground" />
      {:else}
        <span class={['size-1.5', outcome === 'failed' ? 'bg-destructive' : 'bg-muted-foreground']}></span>
      {/if}
    </span>
    <span class="shrink-0 font-medium">{verb}</span>
    <span
      class={[
        'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-meta',
        row === null ? 'border border-dashed border-muted-foreground/50 text-muted-foreground' : 'bg-hover',
      ]}
    >
      <WorktreeSwatch {row} />
      <FadeText text={name} />
    </span>
    {#if absent !== null}<span class="shrink-0 text-muted-foreground">{absent}</span>{/if}
    {@render tail?.()}
  </div>
  {@render children?.()}
</div>
