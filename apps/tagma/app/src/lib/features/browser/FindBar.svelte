<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import X from '@lucide/svelte/icons/x';
  import type { DesktopBrowser } from '@tagma/desktop/bridge';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';

  let { page, bridge, done }: { page: PageId; bridge: DesktopBrowser; done: () => void } = $props();

  let text = $state('');
  let found = $state<{ readonly matches: number; readonly active: number } | null>(null);
  let field = $state<HTMLInputElement>();

  export function focus(): void {
    field?.focus();
    field?.select();
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
    field?.focus();
  });

  function seek(forward: boolean): void {
    if (text === '') {
      bridge.stopFind(page);
      found = null;
      return;
    }
    bridge.find(page, text, forward);
  }
</script>

<div class="flex h-9 shrink-0 items-center gap-1 border-b bg-raised px-2" role="search">
  <input
    bind:this={field}
    bind:value={text}
    class="h-7 min-w-0 flex-1 rounded-md bg-field px-2 text-ui"
    placeholder="Find in page"
    aria-label="Find in page"
    oninput={() => seek(true)}
    onkeydown={(event) => {
      if (event.key === 'Enter') seek(!event.shiftKey);
      else if (event.key === 'Escape') done();
    }}
  />
  <span class="w-16 shrink-0 text-right text-small text-muted-foreground tabular-nums">
    {found === null || text === '' ? '' : found.matches === 0 ? 'No match' : `${found.active} of ${found.matches}`}
  </span>
  <button
    type="button"
    class="grid size-7 place-items-center rounded-md hover:bg-hover"
    aria-label="Previous match"
    onclick={() => seek(false)}
  >
    <ChevronUp class="size-3.5" />
  </button>
  <button type="button" class="grid size-7 place-items-center rounded-md hover:bg-hover" aria-label="Next match" onclick={() => seek(true)}>
    <ChevronDown class="size-3.5" />
  </button>
  <button type="button" class="grid size-7 place-items-center rounded-md hover:bg-hover" aria-label="Close find" onclick={done}>
    <X class="size-3.5" />
  </button>
</div>
