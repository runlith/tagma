<script lang="ts">
  import { Compartment, EditorState, type StateEffect } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { untrack } from 'svelte';
  import { diffView, expandable, type Expanding, expanding, initialRows, rowsChange, seenAfter, textOf } from './extensions/diff';
  import { editingView } from './extensions/editing';
  import { find } from './extensions/find';
  import { type Hooks, hooks } from './extensions/gutters';
  import { type ColouringConfig, colouringConfig, highlight } from './extensions/highlight';
  import { ruler } from './extensions/ruler';
  import { theme } from './extensions/theme';
  import type { Colouring, DiffLine, Expand, PressMark } from './marks';

  type Props = {
    rows: readonly DiffLine[];
    language?: string;
    onExpand?: Expand;
    wrap?: boolean;
    onColouring?: (colouring: Colouring) => void;
    onMark?: PressMark;
  };

  let { rows, language, onExpand, wrap = false, onColouring, onMark }: Props = $props();

  type Settings = { rows: readonly DiffLine[]; language: string | undefined; open: boolean; wrap: boolean };

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let applied: Settings | undefined;
  let mounted = $state(0);

  const report: ColouringConfig['report'] = { onColouring: undefined };
  const pressing: Hooks = { pressMark: undefined };
  const opening: Expanding = { expand: undefined };
  const colours = new Compartment();
  const opens = new Compartment();
  const wrapping = new Compartment();

  const colourConfig = (settings: Settings) => colouringConfig.of({ language: settings.language, report });

  $effect(() => {
    const settings = untrack((): Settings => ({ rows, language, open: onExpand !== undefined, wrap }));
    const made = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: textOf(settings.rows),
        extensions: [
          initialRows(settings.rows),
          diffView,
          editingView,
          find,
          ruler,
          theme,
          highlight,
          hooks.of(pressing),
          expanding.of(opening),
          colours.of(colourConfig(settings)),
          opens.of(expandable.of(settings.open)),
          wrapping.of(settings.wrap ? EditorView.lineWrapping : []),
        ],
      }),
    });
    applied = settings;
    view = made;
    untrack(() => (mounted += 1));
    return () => {
      made.destroy();
      if (view === made) {
        view = undefined;
        applied = undefined;
      }
    };
  });

  $effect(() => {
    report.onColouring = onColouring;
    pressing.pressMark = onMark;
    opening.expand = onExpand;
  });

  $effect(() => {
    if (mounted === 0) return;
    const next: Settings = { rows, language, open: onExpand !== undefined, wrap };
    untrack(() => {
      const before = applied;
      if (view === undefined || before === undefined) return;
      const effects: StateEffect<unknown>[] = [];
      if (next.language !== before.language) effects.push(colours.reconfigure(colourConfig(next)));
      if (next.open !== before.open) effects.push(opens.reconfigure(expandable.of(next.open)));
      if (next.wrap !== before.wrap) effects.push(wrapping.reconfigure(next.wrap ? EditorView.lineWrapping : []));
      applied = next;
      if (next.rows !== before.rows) view.dispatch(rowsChange(view.state, next.rows, effects));
      else if (effects.length > 0) view.dispatch({ effects });
    });
  });

  export function seenLine(): number | null {
    return view === undefined ? null : seenAfter(view);
  }
</script>

<div class="diff" bind:this={host}></div>

<style>
  .diff {
    height: 100%;
    min-height: 0;
  }
</style>
