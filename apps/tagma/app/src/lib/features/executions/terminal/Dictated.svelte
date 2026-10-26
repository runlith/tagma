<script lang="ts">
  import { Dictation } from '$lib/features/speech/dictation/Dictation.svelte.js';
  import Plaque from '$lib/features/speech/dictation/Plaque.svelte';
  import type { Target } from '$lib/features/speech/dictation/target.js';
  import { Targets } from '$lib/features/speech/dictation/Targets.js';
  import type { TerminalPane } from './Pane.svelte.js';

  let { pane, element }: { pane: TerminalPane; element: HTMLElement } = $props();

  const targets = Targets.use();
  const dictation = Dictation.use();
  const target: Target = {
    begin: () => true,
    show: () => true,
    commit: async (text) => (text === '' || (await pane.paste(text)) ? '' : text),
    revert: () => true,
    leave: () => {},
  };

  $effect(() => {
    const unplace = targets.place(element, target);
    return () => {
      unplace();
      dictation.drop(target, 'Dictation stopped: its terminal closed before the phrase was typed.');
    };
  });
</script>

<Plaque {target} />
