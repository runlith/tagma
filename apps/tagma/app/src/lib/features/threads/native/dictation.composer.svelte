<script lang="ts">
  import { untrack } from 'svelte';
  import { Dictation } from '$lib/features/speech/dictation/Dictation.svelte.js';
  import { FieldTarget } from '$lib/features/speech/dictation/field.js';
  import MicButton from '$lib/features/speech/dictation/MicButton.svelte';
  import { Targets } from '$lib/features/speech/dictation/Targets.js';
  import type { ThreadDraft } from '../Draft.svelte.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';

  let {
    draft,
    writes,
    composer,
    surface,
    contributor,
  }: { draft: ThreadDraft; writes: ThreadWrites; composer: ComposerContributions; surface: SlotSurface; contributor: string } = $props();

  const targets = Targets.use();
  const dictation = Dictation.use();
  const dictated = $derived(
    new FieldTarget(
      surface.prompt,
      () => draft.key,
      () => void writes.send(),
    ),
  );

  $effect(() => {
    const element = surface.element;
    if (element === null) return;
    const unplace = targets.place(element, dictated, () => surface.visible && surface.prompt.attached);
    return () => {
      unplace();
      dictation.drop(dictated, 'Dictation stopped: its agent field closed. What was confirmed stays in that draft.');
    };
  });

  $effect(() => {
    void draft.key;
    untrack(() =>
      dictation.drop(
        dictated,
        'Dictation stopped: the agent field moved to another draft. What was confirmed stays in the draft it went into.',
      ),
    );
  });

  $effect.pre(() => composer.chip(contributor, { id: 'dictation', region: 'right', order: 200, body: mic }));
</script>

{#snippet mic()}
  <MicButton target={dictated} />
{/snippet}
