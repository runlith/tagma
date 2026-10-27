<script lang="ts">
  import type { Find } from '@runlith/code-editor/marks';
  import { Host } from '@runlith/layer/Host';
  import { untrack } from 'svelte';
  import FindBar, { type FindTally } from '$lib/shared/ui/find/FindBar.svelte';

  let { find }: { find: Find } = $props();

  const apple = Host.use().apple;

  let bar = $state<FindBar>();

  const tally = $derived<FindTally>(
    find.invalid
      ? { kind: 'refused', words: 'Invalid pattern' }
      : find.matches === null
        ? { kind: 'idle' }
        : { kind: 'counted', total: find.matches.total, current: find.matches.current, more: find.matches.more },
  );

  $effect(() => {
    const asked = find.focus;
    const shown = bar;
    untrack(() => shown?.focus(asked.field));
  });
</script>

<FindBar
  bind:this={bar}
  bind:search={() => find.query.search, (search) => find.set({ search })}
  bind:replacement={() => find.query.replace, (replace) => find.set({ replace })}
  bind:caseSensitive={() => find.query.caseSensitive, (caseSensitive) => find.set({ caseSensitive })}
  bind:wholeWord={() => find.query.wholeWord, (wholeWord) => find.set({ wholeWord })}
  bind:regexp={() => find.query.regexp, (regexp) => find.set({ regexp })}
  {tally}
  {apple}
  onNext={find.next}
  onPrevious={find.previous}
  onClose={find.close}
  onSelectAll={find.selectAll}
  onReplace={find.replaceable ? find.replace : undefined}
  onReplaceAll={find.replaceable ? find.replaceAll : undefined}
/>
