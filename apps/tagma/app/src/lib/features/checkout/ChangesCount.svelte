<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { threadHolder } from '$lib/shared/panes/holder.js';
  import ChangesTail from './ChangesTail.svelte';
  import { type ChangesTail as Tail, changesTail, threadChangesLink } from './changesTail.js';
  import { counted, uncheckedWords } from './holdingWords.js';
  import { changesPane } from './paneContent.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  const changes = ThreadChanges.use();
  const panes = SidePanes.use();
  const opening = Opening.use();
  const here = App.current();

  const tail = $derived(changes.empty ? null : changesTail(changes));
  const shown = $derived(panes.holder === threadHolder(changes.threadId) && panes.shows(changesPane));
  const link = () => threadChangesLink(changes);

  function spoken(said: Tail): string {
    if (said.kind === 'files') return `Changes: ${counted(said.count, 'file', 'files')}`;
    if (said.kind === 'unchecked') return `Changes: ${uncheckedWords(said.count)}`;
    const { added, removed } = said.lines;
    const parts = [
      ...(added > 0 ? [`${counted(added, 'line', 'lines')} added`] : []),
      ...(removed > 0 ? [`${counted(removed, 'line', 'lines')} removed`] : []),
    ];
    return `Changes: ${parts.join(', ')}`;
  }
</script>

{#if tail !== null && !shown}
  <button
    type="button"
    class="flex h-6 shrink-0 items-center rounded-md px-1.5 transition-colors hover:bg-hover"
    aria-label={spoken(tail)}
    data-thread-changes-count
    {@attach linkTarget(opening, link, here)}
  >
    <ChangesTail {tail} />
  </button>
{/if}
