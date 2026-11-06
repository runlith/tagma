<script lang="ts">
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { modeHint, modeIcon as iconOfMode } from '../modeWords.js';
  import ChatButton from './ChatButton.svelte';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import { modeCycle } from './commands/mode.commands.js';

  let {
    views,
    writes,
    composer,
    surface,
    contributor,
  }: {
    views: ThreadViews;
    writes: ThreadWrites;
    composer: ComposerContributions;
    surface: SlotSurface;
    contributor: string;
  } = $props();

  const keymap = Keymap.use();
  const modes = $derived(writes.modes);
  const cycle = $derived(modeCycle(writes));

  $effect.pre(() =>
    surface.sheets ? undefined : composer.chip(contributor, { id: 'mode', region: 'leading', order: -1, body: modeChip, cycle }),
  );
</script>

{#snippet modeChip()}
  {@const current = modes?.declared.find((mode) => mode.id === modes.active)}
  {#if current}
    {#snippet currentIcon()}
      {@const Icon = iconOfMode(current)}
      {#if Icon}<Icon />{/if}
    {/snippet}
    <ChatButton
      control={{
        control: 'mode',
        type: 'button',
        label: current.label,
        title: modeHint(current, views.authority.notes),
        hints: [{ keys: keymap.spellText('Shift+Tab'), words: 'cycles it' }],
        destructive: current.elevated === true,
        leading: currentIcon,
        onclick: () => void writes.perform(cycle.run()),
      }}
    />
  {/if}
{/snippet}
