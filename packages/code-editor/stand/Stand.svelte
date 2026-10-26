<script lang="ts">
  import { untrack } from 'svelte';
  import Diff from '../src/Diff.svelte';
  import { TextDocument } from '../src/document';
  import Editor from '../src/Editor.svelte';
  import type { LineMarker, LineRange, Mark, Strip } from '../src/marks';
  import { codeText, diffRows, remoteDelta } from './fixture';

  const LINES = 100_000;
  const AGENT: Mark = { id: 'thread-a', label: 'Agent · refactor', colour: 'oklch(0.7 0.15 300)' };
  const MARKERS: LineMarker[] = [
    { line: 3, label: 'Заметка графа', colour: 'var(--status-open)' },
    { line: 600, label: 'Заметка графа', colour: 'var(--status-open)' },
  ];

  let tab = $state<'file' | 'diff'>('file');
  let shade = $state<'dark' | 'light'>('dark');
  let streaming = $state(false);
  let wrap = $state(false);
  let strips = $state.raw<readonly Strip[]>([]);
  let conflicts = $state.raw<readonly LineRange[]>([]);
  let status = $state('');
  let hidden = $state(1_000);

  const document = new TextDocument(codeText(LINES), 'fixture-0');
  const rows = $derived(diffRows(20_000, hidden));
  let deltas = 0;

  function deliver(): void {
    deltas += 1;
    const edits = remoteDelta(LINES);
    const started = performance.now();
    const answer = document.rebase(edits, `fixture-${deltas}`);
    const spent = performance.now() - started;
    const edit = edits[0];
    if (answer.kind === 'conflict') conflicts = answer.ranges;
    else if (answer.kind === 'applied' && edit !== undefined) {
      strips = [{ from: edit.from, to: edit.to, kind: 'changed', mark: AGENT }];
    }
    status = `дельта ${deltas}: ${answer.kind} за ${spent.toFixed(2)} мс · буфер ${document.dirty ? 'изменён' : 'чист'}`;
  }

  $effect(() => {
    if (!streaming) return;
    const timer = setInterval(() => untrack(deliver), 400);
    return () => clearInterval(timer);
  });

  $effect(() => {
    window.document.documentElement.classList.toggle('dark', shade === 'dark');
  });

  function expand(_at: number, lines: number): void {
    hidden = Math.max(0, hidden - lines);
  }
</script>

<div class="stand">
  <header>
    <button type="button" aria-pressed={tab === 'file'} onclick={() => (tab = 'file')}>Файл · 100 000 строк</button>
    <button type="button" aria-pressed={tab === 'diff'} onclick={() => (tab = 'diff')}>Diff · 20 000 строк</button>
    <span class="gap"></span>
    <label><input type="checkbox" bind:checked={streaming} /> Поток внешних дельт</label>
    <label><input type="checkbox" bind:checked={wrap} /> Перенос</label>
    <button type="button" onclick={() => (shade = shade === 'dark' ? 'light' : 'dark')}>Тема: {shade}</button>
    <button type="button" onclick={() => (conflicts = [])}>Снять конфликт</button>
    <span class="status">{status}</span>
  </header>
  <main>
    {#if tab === 'file'}
      <Editor {document} language="typescript" {strips} markers={MARKERS} {conflicts} {wrap} />
    {:else}
      <Diff {rows} language="typescript" {wrap} onExpand={expand} />
    {/if}
  </main>
</div>

<style>
  .stand {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--chrome);
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-ui);
  }

  header {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 3);
    padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
    border-bottom: 1px solid var(--border);
  }

  header button {
    background: var(--raised);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
    font: inherit;
    cursor: pointer;
  }

  header button[aria-pressed='true'] {
    background: var(--selected);
  }

  .gap {
    flex: 1;
  }

  .status {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-small);
  }

  main {
    flex: 1;
    min-height: 0;
  }
</style>
