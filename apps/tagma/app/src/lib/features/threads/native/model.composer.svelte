<script lang="ts">
  import type { ComposerPanel } from '@runlith/chat-ui/composer';
  import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import ModelPanel from './ModelPanel.svelte';
  import ModelPicker from './ModelPicker.svelte';

  let {
    shown,
    chat,
    birth,
    views,
    writes,
    panel,
    composer,
    surface,
    contributor,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    birth: ThreadBirth;
    views: ThreadViews;
    writes: ThreadWrites;
    panel: ModelPanelState;
    composer: ComposerContributions;
    surface: SlotSurface;
    contributor: string;
  } = $props();

  const connect = $derived(shown.id === null && !birth.settings.connecting ? () => birth.settings.connectAnotherWay() : undefined);

  $effect.pre(() => (surface.lead ? undefined : composer.chip(contributor, { id: 'model', region: 'leading', order: 2, body: picker })));

  $effect.pre(() =>
    surface.sheets
      ? undefined
      : composer.panel(contributor, {
          id: 'model',
          get open() {
            return panel.current !== null;
          },
          body: modelPanel,
          close: () => panel.close(),
        }),
  );
</script>

{#snippet picker()}
  <ModelPicker {views} {panel} onConnect={connect} />
{/snippet}

{#snippet modelPanel(door: ComposerPanel)}
  {#if panel.current !== null}
    <ModelPanel {shown} {chat} {views} {writes} {panel} {door} />
  {/if}
{/snippet}
