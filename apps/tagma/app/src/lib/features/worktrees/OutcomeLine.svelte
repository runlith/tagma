<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import type { ClassValue } from 'svelte/elements';
  import { fade } from 'svelte/transition';
  import { Finishing, type Outcome } from './Finishing.svelte.js';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  let { outcome, named = false, class: className = '' }: { outcome: Outcome; named?: boolean; class?: ClassValue } = $props();

  const SHOWN_MS = 6_000;

  const finishing = Finishing.use();

  const refused = $derived(outcome.refusal !== null);

  $effect(() => {
    if (outcome.refusal !== null) return;
    const id = outcome.id;
    const fading = setTimeout(() => finishing.dismiss(id), SHOWN_MS);
    return () => clearTimeout(fading);
  });

  const LINK = 'shrink-0 whitespace-nowrap rounded-sm px-1 text-foreground/80 transition-colors hover:bg-hover hover:text-foreground';
</script>

<div
  class={['group/outcome grid min-w-0 gap-0.5 text-small leading-snug', className]}
  in:fade={{ duration: 160 }}
  out:fade={{ duration: 220 }}
  role={refused ? 'alert' : 'status'}
  data-worktree-outcome={refused ? 'refused' : 'done'}
>
  <div class="flex min-w-0 items-center gap-2">
    {#if refused}
      <TriangleAlert class="size-3 shrink-0 text-destructive" />
    {:else}
      <Check class="size-3 shrink-0 text-status-done" />
    {/if}
    {#if named}
      <WorktreeSwatch row={{ hue: outcome.hue, kind: 'tagma' }} />
      <span class="max-w-[45%] shrink-0 truncate font-mono text-foreground/80">{outcome.label}</span>
    {/if}
    <span class={['min-w-0 truncate', refused ? 'text-destructive/90' : 'text-muted-foreground']}>{outcome.words}</span>
    {#if outcome.link !== null}
      <a href={outcome.link} target="_blank" rel="noopener noreferrer" class={[LINK, 'inline-flex items-center gap-1']}>
        <ExternalLink class="size-3" />Open
      </a>
    {/if}
    {#if outcome.detail !== null}
      <button type="button" class={LINK} onclick={() => finishing.detail(outcome)}>Details</button>
    {/if}
    <button
      type="button"
      class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
      aria-label="Dismiss"
      onclick={() => finishing.dismiss(outcome.id)}
    >
      <X class="size-3" />
    </button>
  </div>
  {#if outcome.refusal !== null}
    <p class="pl-5 text-foreground/70">{outcome.refusal.reason}</p>
    {#each outcome.refusal.unblock as way (way)}
      <p class="pl-5 text-muted-foreground">{way}</p>
    {/each}
  {/if}
</div>
