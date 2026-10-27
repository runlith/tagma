<script module lang="ts">
  import { findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search';
  import type { Extension } from '@codemirror/state';
  import type { EditorView } from '@codemirror/view';
  import { closeFind, finder, type FindHooks, findHooks, type Finding, finding, seek, selectFound } from './extensions/find';
  import type { Find, FindFocus, FindQuery } from './marks';

  const UNASKED: FindQuery = { search: '', caseSensitive: false, wholeWord: false, regexp: false, replace: '' };

  export class FindBridge {
    found = $state.raw<Finding | null>(null);
    focus = $state.raw<FindFocus>({ field: 'search' });
    readonly hooks: FindHooks;
    readonly control: Find;
    private layer: HTMLDivElement | undefined = undefined;

    extension(drawn: boolean): Extension {
      return drawn ? [finder, findHooks.of(this.hooks)] : [];
    }

    readonly hold = (node: HTMLDivElement): (() => void) => {
      this.layer = node;
      return () => {
        if (this.layer === node) this.layer = undefined;
      };
    };

    constructor(view: () => EditorView | undefined) {
      const run = (act: (shown: EditorView) => unknown): void => {
        const shown = view();
        if (shown !== undefined) act(shown);
      };
      this.hooks = {
        opened: (opened) => {
          this.found = finding(opened.state);
          this.focus = { field: 'search' };
        },
        moved: (moved) => (this.found = finding(moved.state)),
        closed: () => (this.found = null),
        asked: (field) => (this.focus = { field }),
        cover: () => (this.layer === undefined ? 0 : this.layer.offsetTop + this.layer.offsetHeight),
      };
      const bridge = this;
      this.control = {
        get query() {
          return bridge.found?.query ?? UNASKED;
        },
        get matches() {
          return bridge.found?.matches ?? null;
        },
        get invalid() {
          return bridge.found?.invalid ?? false;
        },
        get replaceable() {
          return bridge.found?.replaceable ?? false;
        },
        get focus() {
          return bridge.focus;
        },
        set: (patch) => run((shown) => seek(shown, patch)),
        next: () => run(findNext),
        previous: () => run(findPrevious),
        selectAll: () => run(selectFound),
        replace: () => run(replaceNext),
        replaceAll: () => run(replaceAll),
        close: () => run(closeFind),
      };
    }
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { bridge, find }: { bridge: FindBridge; find: Snippet<[Find]> | undefined } = $props();
</script>

{#if bridge.found !== null && find !== undefined}
  <div class="find" {@attach bridge.hold}>{@render find(bridge.control)}</div>
{/if}

<style>
  .find {
    position: absolute;
    top: calc(var(--spacing) * 2);
    right: calc(var(--spacing) * 5);
    left: calc(var(--spacing) * 2);
    z-index: 5;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
  }

  .find > :global(*) {
    pointer-events: auto;
  }
</style>
