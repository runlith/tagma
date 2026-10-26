import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { terminalChat } from '@tagma/server/external-harnesses/settings';
import { expect, test } from 'vitest';
import { SurfaceChoices, ThreadSurface } from './Surface.svelte.js';

const CAPABILITIES = {
  messaging: true,
  judgedModel: false,
  history: 'none',
  compaction: 'none',
  modelMove: 'pinned',
  openings: 'core',
  pictures: true,
  law: null,
  touch: null,
  authorship: null,
  steer: 'none',
  withdraw: false,
  callEnvelopeMs: null,
} as const;

const thread = (id: string, transport: 'terminal' | 'acp' | null, process: 'running' | 'ended' | null = 'running'): WireThread =>
  ({
    id,
    agentId: transport === null ? 'tagma' : 'harness',
    capabilities: { ...CAPABILITIES, screen: transport === 'terminal' },
    harness:
      transport === null
        ? null
        : {
            name: 'claude-code',
            transport,
            agent: null,
            capabilities: { ...CAPABILITIES, screen: transport === 'terminal' },
            execution: { execution: 'run', incarnation: 2 },
            process: process === null ? null : { id: 'p-1', state: process, startedAt: '2026-10-09T10:00:00.000Z' },
          },
  }) as WireThread;

const settings = (chatOver: () => boolean) =>
  ({
    catalog: { key: () => ({ data: { entries: [{ id: terminalChat.id, value: chatOver() }] } }) },
  }) as never;

test('the surface follows the screen capability its thread declares: a standing screen opens the terminal unless the chat over the journal is chosen, a thread whose process is not standing takes words in the chat, and a moved transport switches it', () => {
  let shown = $state.raw<WireThread | null>(null);
  let chatOver = $state(false);
  const surface = new ThreadSurface(7, () => shown, new SurfaceChoices(settings(() => chatOver)));
  expect(surface.kind).toBe('chat');

  shown = thread('native', null);
  expect(surface.kind).toBe('chat');
  shown = thread('sdk', 'acp');
  expect(surface.kind).toBe('chat');
  expect(surface.terminal).toBeNull();

  shown = thread('cli', 'terminal');
  expect(surface.kind).toBe('terminal');
  expect(surface.terminal).toMatchObject({ threadId: 'cli', projectId: 7, execution: { execution: 'run', incarnation: 2 } });

  chatOver = true;
  expect(surface.kind).toBe('chat');
  expect(surface.terminal).toBeNull();

  chatOver = false;
  shown = thread('cli', 'terminal', 'ended');
  expect(surface.kind).toBe('chat');
  shown = thread('cli', 'terminal', null);
  expect(surface.kind).toBe('chat');
  expect(surface.terminal).toBeNull();

  shown = thread('cli', 'acp');
  expect(surface.kind).toBe('chat');
  expect(surface.terminal).toBeNull();
});

test('a screened thread switches between its terminal and its journal by its own act, over the project default and without touching another thread, and a thread with nothing to switch to stays put', () => {
  let shown = $state.raw<WireThread | null>(thread('cli', 'terminal'));
  let chatOver = $state(false);
  const choices = new SurfaceChoices(settings(() => chatOver));
  const surface = new ThreadSurface(7, () => shown, choices);
  const other = new ThreadSurface(7, () => thread('other', 'terminal'), choices);

  surface.toggle();
  expect(surface.kind).toBe('chat');
  expect(other.kind).toBe('terminal');

  chatOver = true;
  surface.toggle();
  expect(surface.kind).toBe('terminal');
  expect(other.kind).toBe('chat');

  shown = thread('cli', 'terminal', 'ended');
  expect(surface.switchable).toBe(false);
  surface.toggle();
  expect(surface.kind).toBe('chat');
  shown = thread('cli', 'terminal');
  expect(surface.kind).toBe('terminal');

  shown = thread('sdk', 'acp');
  expect(surface.switchable).toBe(false);
  surface.toggle();
  expect(surface.kind).toBe('chat');
});
