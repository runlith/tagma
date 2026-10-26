<script lang="ts">
  import type { ComposerDropState } from '@runlith/chat-ui/composer';
  import { mentionedProject } from '@tagma/server/projects/contract/wire/references';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import type { Mention } from './MentionDrops.svelte.js';

  let { state, incoming }: { state: ComposerDropState; incoming: readonly Mention[] } = $props();

  const CHIP = 'flex min-w-0 max-w-72 items-center gap-1.5 rounded-lg border py-1 text-small';
</script>

{#if state === 'aimed'}
  {#each incoming as mention (mention.name)}
    {@const project = mentionedProject(mention.name)}
    <span class={[CHIP, 'border-status-open bg-raised px-2']} data-mention-preview>
      {#if project === null}<AgentIcon class="size-3.5 shrink-0 text-status-open" />{:else}<Swatch projectId={project} />{/if}
      <FadeText text={mention.title.trim() || 'Untitled'} />
    </span>
  {/each}
{:else}
  <span class={[CHIP, 'border-dashed border-foreground/30 bg-raised px-2 text-muted-foreground']} data-mention-slot>Drop to mention</span>
{/if}
