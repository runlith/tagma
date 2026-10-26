<script lang="ts">
  import { Compartment, EditorState, type StateEffect } from '@codemirror/state';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { untrack } from 'svelte';
  import type { TextDocument } from './document';
  import { detectIndent, editing, editingView } from './extensions/editing';
  import { find } from './extensions/find';
  import { type Hooks, hooks, lineGutters, setConflicts, setLineMarkers, setStrips } from './extensions/gutters';
  import { type ColouringConfig, colouringConfig, highlight } from './extensions/highlight';
  import { ruler } from './extensions/ruler';
  import { theme } from './extensions/theme';
  import type { Colouring, LineMarker, LineRange, Position, PressMark, Seen, Strip } from './marks';
  import { sameConflicts, sameMarkers, sameStrips } from './settings';

  type Props = {
    document: TextDocument;
    language?: string;
    strips?: readonly Strip[];
    markers?: readonly LineMarker[];
    conflicts?: readonly LineRange[];
    readOnly?: boolean;
    wrap?: boolean;
    at?: Position | null;
    onColouring?: (colouring: Colouring) => void;
    onMark?: PressMark;
    onView?: (seen: Seen) => void;
  };

  let {
    document,
    language,
    strips = [],
    markers = [],
    conflicts = [],
    readOnly = false,
    wrap = false,
    at = null,
    onColouring,
    onMark,
    onView,
  }: Props = $props();

  type Settings = {
    language: string | undefined;
    readOnly: boolean;
    wrap: boolean;
    strips: readonly Strip[];
    markers: readonly LineMarker[];
    conflicts: readonly LineRange[];
  };

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let applied: Settings | undefined;
  let mounted = $state(0);

  const report: ColouringConfig['report'] = { onColouring: undefined };
  const pressing: Hooks = { pressMark: undefined };
  const leaving: { onView: ((seen: Seen) => void) | undefined } = { onView: undefined };
  const colours = new Compartment();
  const editable = new Compartment();
  const access = new Compartment();
  const wrapping = new Compartment();

  const colourConfig = (settings: Settings) => colouringConfig.of({ language: settings.language, report });

  $effect(() => {
    const opened = document;
    const settings = untrack((): Settings => ({ language, readOnly, wrap, strips, markers, conflicts }));
    const indent = detectIndent(opened.doc);
    const made = untrack(() =>
      opened.mount(host, [
        lineNumbers(),
        lineGutters,
        editingView,
        find,
        ruler,
        theme,
        highlight,
        hooks.of(pressing),
        colours.of(colourConfig(settings)),
        editable.of(editing(settings.language, indent)),
        access.of(EditorState.readOnly.of(settings.readOnly)),
        wrapping.of(settings.wrap ? EditorView.lineWrapping : []),
      ]),
    );
    if (settings.strips.length + settings.markers.length + settings.conflicts.length > 0) {
      made.dispatch({ effects: [setStrips.of(settings.strips), setLineMarkers.of(settings.markers), setConflicts.of(settings.conflicts)] });
    }
    applied = { ...settings };
    view = made;
    untrack(() => (mounted += 1));
    return () => {
      const { anchor, head } = made.state.selection.main;
      const line = made.state.doc.lineAt(head);
      const start = made.state.doc.lineAt(anchor);
      leaving.onView?.({
        line: line.number - 1,
        column: head - line.from,
        anchor: { line: start.number - 1, column: anchor - start.from },
        scroll: made.scrollDOM.scrollTop,
      });
      made.destroy();
      if (view === made) {
        view = undefined;
        applied = undefined;
      }
    };
  });

  export function focusLine(): number | null {
    if (view === undefined) return null;
    const doc = view.state.doc;
    const cursor = doc.lineAt(view.state.selection.main.head).number;
    const scroller = view.scrollDOM;
    const seen = Math.max(scroller.getBoundingClientRect().top - view.documentTop, 0);
    const top = doc.lineAt(view.lineBlockAtHeight(seen).from).number;
    const bottom = doc.lineAt(view.lineBlockAtHeight(seen + scroller.clientHeight).from).number;
    return cursor >= top && cursor <= bottom ? cursor : top;
  }

  $effect(() => {
    report.onColouring = onColouring;
    pressing.pressMark = onMark;
    leaving.onView = onView;
  });

  $effect(() => {
    if (mounted === 0) return;
    const next: Settings = { language, readOnly, wrap, strips, markers, conflicts };
    untrack(() => {
      const before = applied;
      if (view === undefined || before === undefined) return;
      const effects: StateEffect<unknown>[] = [];
      if (next.language !== before.language) {
        effects.push(colours.reconfigure(colourConfig(next)));
        effects.push(editable.reconfigure(editing(next.language, detectIndent(view.state.doc))));
      }
      if (next.readOnly !== before.readOnly) effects.push(access.reconfigure(EditorState.readOnly.of(next.readOnly)));
      if (next.wrap !== before.wrap) effects.push(wrapping.reconfigure(next.wrap ? EditorView.lineWrapping : []));
      if (!sameStrips(before.strips, next.strips)) effects.push(setStrips.of(next.strips));
      if (!sameMarkers(before.markers, next.markers)) effects.push(setLineMarkers.of(next.markers));
      if (!sameConflicts(before.conflicts, next.conflicts)) effects.push(setConflicts.of(next.conflicts));
      applied = next;
      if (effects.length > 0) view.dispatch({ effects });
    });
  });

  $effect(() => {
    if (mounted === 0 || at === null) return;
    const target = at;
    untrack(() => {
      if (view === undefined) return;
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(target.line, 0), doc.lines - 1) + 1);
      const point = line.from + Math.min(Math.max(target.column ?? 0, 0), line.length);
      const start = target.anchor === undefined ? line : doc.line(Math.min(Math.max(target.anchor.line, 0), doc.lines - 1) + 1);
      const anchor = target.anchor === undefined ? point : start.from + Math.min(Math.max(target.anchor.column, 0), start.length);
      const head = target.anchor === undefined ? Math.min(point + Math.max(target.length ?? 0, 0), line.to) : point;
      const scroll = target.scroll;
      if (scroll === undefined) {
        view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(head, { y: 'center' }) });
        return;
      }
      view.dispatch({ selection: { anchor, head } });
      const scrolled = view;
      scrolled.requestMeasure({ read: () => null, write: () => (scrolled.scrollDOM.scrollTop = scroll) });
    });
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    min-height: 0;
  }
</style>
