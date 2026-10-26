import { openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { flushSync, mount, unmount } from 'svelte';
import { TextDocument } from '../src/document';
import Editor from '../src/Editor.svelte';
import type { Strip } from '../src/marks';
import { codeText, remoteDelta } from './fixture';

type Spread = { count: number; p50: number; p95: number; p99: number; max: number };

type Load = { strips?: number; find?: string };

const target = document.getElementById('probe') as HTMLElement;
let shown: ReturnType<typeof mount> | undefined;
let opened: { document: TextDocument; view: EditorView; lines: number } | undefined;

const painted = (): Promise<number> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve(performance.now());
      channel.port2.postMessage(null);
    }),
  );

const round = (value: number): number => Math.round(value * 100) / 100;

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1) ?? 0) };
}

function allColoured(): boolean {
  const lines = [...target.querySelectorAll('.cm-content .cm-line')].filter((line) => (line.textContent ?? '').trim() !== '');
  return lines.length > 0 && lines.every((line) => line.querySelector('span[style*="color"]') !== null);
}

function stripsOf(count: number, lines: number): Strip[] {
  const step = Math.max(1, Math.floor(lines / count));
  return Array.from({ length: count }, (_, at) => ({ from: at * step, to: at * step + 1, kind: 'changed' as const, mark: null }));
}

async function open(lines: number, load: Load = {}): Promise<{ lines: number; mount: number; firstFrame: number; coloured: number }> {
  if (shown !== undefined) await unmount(shown);
  target.replaceChildren();
  const text = codeText(lines);
  const started = performance.now();
  const document = new TextDocument(text, 'probe-0');
  const strips = load.strips === undefined ? [] : stripsOf(load.strips, lines);
  shown = mount(Editor, { target, props: { document, language: 'typescript', strips } });
  flushSync();
  const mounted = performance.now() - started;
  const firstFrame = (await painted()) - started;
  let coloured = Number.NaN;
  for (let waited = 0; waited < 600; waited += 1) {
    const now = await painted();
    if (allColoured()) {
      coloured = now - started;
      break;
    }
  }
  const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;
  if (load.find !== undefined) {
    openSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: load.find })) });
  }
  opened = { document, view, lines };
  return { lines, mount: round(mounted), firstFrame: round(firstFrame), coloured: round(coloured) };
}

function middle(view: EditorView): number {
  const line = view.state.doc.line(Math.floor(view.state.doc.lines / 2));
  view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.to, { y: 'center' }) });
  return line.to;
}

async function focusMiddle(): Promise<void> {
  if (opened === undefined) throw new Error('open a file first');
  middle(opened.view);
  opened.view.focus();
  await painted();
}

function plain(): void {
  if (shown !== undefined) void unmount(shown);
  shown = undefined;
  opened = undefined;
  const area = document.createElement('textarea');
  area.style.width = '100%';
  area.style.height = '100%';
  area.value = codeText(200);
  target.replaceChildren(area);
  area.focus();
}

let slow: PerformanceEventTiming[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries() as PerformanceEventTiming[]) if (entry.name === 'keydown') slow.push(entry);
});

function watch(): void {
  slow = [];
  observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
}

function stop(keys: number): { keys: number; over16: number; durations: Spread; processing: Spread } {
  observer.disconnect();
  return {
    keys,
    over16: slow.filter((entry) => entry.duration > 16).length,
    durations: spread(slow.map((entry) => entry.duration)),
    processing: spread(slow.map((entry) => entry.processingEnd - entry.processingStart)),
  };
}

async function remote(count: number, unsaved: number): Promise<{ sync: Spread; conflicts: number }> {
  if (opened === undefined) throw new Error('open a file first');
  const { document, view, lines } = opened;
  const step = unsaved > 0 ? Math.max(1, Math.floor(lines / unsaved)) : lines;
  const edits = [];
  for (let line = 1; line <= view.state.doc.lines && edits.length < unsaved; line += step)
    edits.push({ from: view.state.doc.line(line).to, insert: ' typed' });
  if (edits.length > 0) view.dispatch({ changes: edits, userEvent: 'input.type' });
  await painted();
  const sync: number[] = [];
  let conflicts = 0;
  for (let delta = 0; delta < count; delta += 1) {
    const at = 2 + ((delta * 7_919) % (lines - 20));
    const lineEdits = remoteDelta(lines, 10, at - (at % step) + 2);
    const started = performance.now();
    const answer = document.rebase(lineEdits, `probe-${delta + 1}`);
    sync.push(performance.now() - started);
    if (answer.kind === 'conflict') conflicts += 1;
    await painted();
  }
  return { sync: spread(sync), conflicts };
}

Object.assign(window, { probe: { open, focusMiddle, plain, watch, stop, remote, ready: true } });
