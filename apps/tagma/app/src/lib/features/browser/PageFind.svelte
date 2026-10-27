<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import type { DesktopBrowser } from '@tagma/desktop/bridge';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import FindBar, { type FindTally } from '$lib/shared/ui/find/FindBar.svelte';

  let { page, bridge, done }: { page: PageId; bridge: DesktopBrowser; done: () => void } = $props();

  const apple = Host.use().apple;

  let text = $state('');
  let found = $state<{ readonly matches: number; readonly active: number } | null>(null);
  let bar = $state<FindBar>();

  const tally = $derived<FindTally>(
    found === null || text === ''
      ? { kind: 'idle' }
      : { kind: 'counted', total: found.matches, current: found.active > 0 ? found.active : null, more: false },
  );

  export function focus(): void {
    bar?.focus();
  }

  $effect(() => {
    const shown = page;
    const off = bridge.onFound((result) => {
      if (result.page === shown) found = { matches: result.matches, active: result.active };
    });
    return () => {
      off();
      bridge.stopFind(shown);
    };
  });

  $effect(() => {
    bar?.focus();
  });

  function seek(forward: boolean): void {
    if (text === '') {
      bridge.stopFind(page);
      found = null;
      return;
    }
    bridge.find(page, text, forward);
  }

  function sought(next: string): void {
    text = next;
    seek(true);
  }
</script>

<FindBar
  bind:this={bar}
  docked
  bind:search={() => text, sought}
  {tally}
  {apple}
  onNext={() => seek(true)}
  onPrevious={() => seek(false)}
  onClose={done}
/>
