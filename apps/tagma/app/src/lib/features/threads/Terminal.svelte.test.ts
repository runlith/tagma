// @vitest-environment jsdom
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { PathRoads } from '$lib/features/checkout/PathRoads.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import { Graph } from '@runlith/layer/Graph';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { tick } from 'svelte';
import { expect, test } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveStatus } from '$lib/wire/Live.js';
import { TerminalAppearance } from '$lib/features/executions/appearance/Settings.svelte.js';
import { TerminalKeymap } from '$lib/features/executions/terminal/Keymap.js';
import { terminalKeymap } from '$lib/features/executions/terminal/testing/keys.svelte.js';
import { TerminalOutput, pageHidden, pageTime } from '$lib/features/executions/terminal/Output.js';
import { TerminalRenderPolicy } from '$lib/features/executions/terminal/RenderPolicy.js';
import { TerminalHolders } from '$lib/features/executions/terminal/Holders.svelte.js';
import { LaneSockets } from '$lib/wire/LaneSockets.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { ExecutionsRepo, type ExecutionAddress } from '$lib/features/executions/Repo.js';
import { TerminalViews } from '$lib/features/executions/terminal/Views.svelte.js';
import type { HarnessOpenAttempt, HarnessOpenStage } from './OpenWatch.js';
import { ThreadTerminal } from './Terminal.svelte.js';

const MINE = 'thread-1';

const THE_CLI: ExecutionAddress = { execution: 'the-cli', incarnation: 0 };

function row(over: { process?: unknown } = {}): HarnessRowDetail {
  return {
    name: 'claude-code',
    process: over.process === undefined ? { id: 'session-1', state: 'running', startedAt: '2026-09-18T00:00:00.000Z' } : over.process,
  } as unknown as HarnessRowDetail;
}

const listing = (address: ExecutionAddress) => ({
  record: {
    projectId: 1,
    execution: address,
    transport: 'pty',
    lifetime: 'held',
    holder: 'operator',
    revision: 7,
    program: '/usr/bin/claude',
    cwd: '/root',
    acceptedAt: 0,
  },
  state: { phase: 'running' },
});

type Reads = {
  record?: (address: ExecutionAddress) => unknown;
  harness?: () => HarnessRowDetail | null;
  execution?: ExecutionAddress | null;
  attempt?: HarnessOpenAttempt | null;
};

function stand(reads: Reads = {}) {
  const answer = reads.record ?? ((address: ExecutionAddress) => listing(address));
  const repo = {
    inventory: {
      key: () => {
        throw new Error('the standing roster is not this page’s to read');
      },
    },
    record: {
      key: (address: ExecutionAddress) => ({ refresh: async () => answer(address) }),
    },
    operation: { key: () => ({ refresh: async () => ({ _tag: 'Whole', state: { _tag: 'Unknown', operation: {} } }) }) },
    bytes: { key: () => ({ refresh: async () => ({ bytes: '', nextOffset: '0', eof: true }) }) },
    laneClose: { run: async () => ({ closed: true }) },
    start: { run: async () => undefined },
    stop: { run: async () => undefined },
  };
  const loud = (...args: unknown[]) => {
    throw args[0] instanceof Error ? args[0] : new Error('refusal in stand');
  };
  const statuses = new Set<(status: LiveStatus) => void>();
  const readings = new Set<() => void>();
  const readers: ThreadTerminal[] = [];
  const live = {
    status: 'open',
    hold: () => ({ unsubscribe: () => undefined }),
    subscribeStatus: (listener: (status: LiveStatus) => void) => {
      statuses.add(listener);
      listener('open');
      return () => statuses.delete(listener);
    },
    call: async () => {
      throw new Error('the socket lane is not part of this case');
    },
  };
  const commands = {
    onReading: (listener: () => void) => {
      readings.add(listener);
      return () => readings.delete(listener);
    },
  };
  let panes!: TerminalViews;
  let terminal!: ThreadTerminal;
  const stop = $effect.root(() => {
    const scope = Scope.make('thread-terminal-test');
    const graph = new Graph(
      Layer.mergeAll(
        Layer.of(ExecutionsRepo, repo as never),
        Layer.of(TerminalRenderPolicy, {
          resume: () => undefined,
          suspend: () => undefined,
          scheduleReveal: () => undefined,
          join: () => () => undefined,
          forget: () => undefined,
          joinPage: () => undefined,
          leavePage: () => undefined,
          hide: () => undefined,
          unhide: () => undefined,
        } as never),
        Layer.of(TerminalAppearance, {
          activeTab: null,
          paneBackground: '#000',
          paneStyle: () => ({}),
          options: () => ({}),
          theme: () => ({}),
          register: () => () => undefined,
          ligaturesOn: () => false,
        } as never),
        Layer.of(TerminalHolders, new TerminalHolders(() => [], ThreadNames.make())),
        Layer.of(Notices, { error: loud, refusal: loud } as never),
        Layer.of(Host, new Host('tab', 'linux')),
        Layer.of(FileOpener, { open: () => Promise.resolve(), stage: () => () => undefined, stand: () => () => undefined } as never),
        Layer.of(PathRoads, { road: () => async () => null } as never),
        Layer.of(Opening, {
          open: () => {
            throw new Error('links are not part of this case');
          },
        } as never),
        Layer.of(Live, live as never),
        Layer.of(
          LaneSockets,
          new LaneSockets(() => {
            throw new Error('a terminal lane is not part of this case');
          }),
        ),
        Layer.of(Door, {} as never),
        Layer.of(ProjectDoor, { lens: () => ({ project: '1' }) } as never),
        Layer.of(TerminalOutput, new TerminalOutput(pageTime(), pageHidden, scope)),
        Layer.of(TerminalKeymap, terminalKeymap(new Host('tab', 'linux'))),
      ),
      { ladder: [ProjectRung], effectRoot: (build) => $effect.root(build) },
    );
    const app = Scope.make('thread-terminal-app');
    void graph.open(app);
    const rung = graph.openRung(app, ProjectRung, { projectId: 1 });
    void rung.ready;
    panes = new TerminalViews(rung.scope, { zoom: () => undefined, resetZoom: () => undefined } as never, () => undefined);
    terminal = reader(reads);
  });
  function reader(over: Reads = reads): ThreadTerminal {
    const reader = new ThreadTerminal(
      MINE,
      1,
      over.execution ?? null,
      over.harness ?? (() => null),
      over.attempt ?? null,
      repo as never,
      panes,
      live as never,
      commands as never,
    );
    readers.push(reader);
    return reader;
  }
  return {
    terminal,
    reader,
    panes,
    reconnect: () => {
      for (const status of ['closed', 'open'] as const) for (const hear of statuses) hear(status);
    },
    answered: () => {
      for (const hear of readings) hear();
    },
    stop: () => {
      for (const reader of readers) reader.drop();
      stop();
    },
  };
}

test('the page mounts the pty its thread names, read from that record', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');
    expect(pane.address).toEqual(THE_CLI);
    expect(owned.terminal.state).toEqual({ kind: 'restoring', done: 0, total: null });
  } finally {
    owned.stop();
  }
});

test('an adopted session that ends lets go of the shell’s pane without ending it, and draws the ended session', async () => {
  let process: unknown = { id: 'session-1', state: 'running', startedAt: '2026-09-18T00:00:00.000Z', origin: 'adopted' };
  const owned = stand({ execution: THE_CLI, harness: () => row({ process }) });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane over the shell');
    process = { id: 'session-1', state: 'ended', startedAt: '2026-09-18T00:00:00.000Z', origin: 'adopted' };
    owned.terminal.settle();
    expect(owned.terminal.pane).toBe(null);
    expect(pane.ending).toBe(null);
    expect(owned.panes.pane(MINE)).toBe(null);
    await owned.terminal.read(THE_CLI);
    expect(owned.terminal.pane).toBe(null);
  } finally {
    owned.stop();
  }
});

test('a facet naming no pty yet draws connecting, and the address landing raises the pane', async () => {
  const owned = stand({
    harness: () => row({ process: { id: 'session-1', state: 'starting', startedAt: '2026-09-18T00:00:00.000Z' } }),
  });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'connecting' });
    expect(owned.terminal.pane).toBe(null);

    await owned.terminal.read(THE_CLI);
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page kept the null it was born with');
    expect(pane.address).toEqual(THE_CLI);
    expect(owned.terminal.state).toEqual({ kind: 'restoring', done: 0, total: null });
  } finally {
    owned.stop();
  }
});

test('a thread whose pane stands is adopted without a second read or bind', async () => {
  let reads = 0;
  const owned = stand({
    execution: THE_CLI,
    record: (address) => {
      reads += 1;
      if (reads > 1) throw new Error('the record was read again over a standing pane');
      return listing(address);
    },
  });
  try {
    await owned.terminal.read();
    const first = owned.terminal.pane;
    if (first === null) throw new Error('the page raised no pane');
    owned.terminal.drop();

    const again = owned.reader();
    await again.read();
    expect(again.pane).toBe(first);
    expect(reads).toBe(1);
  } finally {
    owned.stop();
  }
});

test('the pane’s own replay mark is what turns restoring into live', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'restoring', done: 0, total: null });
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');
    pane.replayedAt = 1;
    expect(owned.terminal.state).toEqual({ kind: 'live' });
  } finally {
    owned.stop();
  }
});

test('the restoring state carries the replay’s figure', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');

    pane.replayedBytes = 12_000;
    pane.replayedTotal = 40_000;
    expect(owned.terminal.state).toEqual({ kind: 'restoring', done: 12_000, total: 40_000 });

    pane.replayedAt = 1;
    expect(owned.terminal.state).toEqual({ kind: 'live' });
  } finally {
    owned.stop();
  }
});

test('a temporary record refusal recovers the same CLI when the connection returns', async () => {
  let refuse = true;
  const owned = stand({
    execution: THE_CLI,
    record: (address) => {
      if (refuse) throw { code: 'terminal-host-unavailable-unreachable', reason: 'the host is offline', unblock: [] };
      return listing(address);
    },
  });
  try {
    await owned.terminal.read();
    expect(owned.terminal.pane).toBe(null);
    refuse = false;
    owned.reconnect();
    await tick();
    expect(owned.terminal.pane?.address).toEqual(THE_CLI);
  } finally {
    owned.stop();
  }
});

test('a host answer arriving during a failed CLI read resumes it after the old request settles', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof listing>>();
  let first = true;
  const owned = stand({
    execution: THE_CLI,
    record: (address) => {
      if (!first) return listing(address);
      first = false;
      return pending.promise;
    },
  });
  try {
    const reading = owned.terminal.read();
    owned.answered();
    pending.reject({ code: 'terminal-host-closed', reason: 'the old connection closed', unblock: [] });
    await reading;
    expect(owned.terminal.pane?.address).toEqual(THE_CLI);
  } finally {
    owned.stop();
  }
});

test('a dropped CLI does not read again when its connection or inventory returns', async () => {
  let reads = 0;
  const owned = stand({
    execution: THE_CLI,
    record: () => {
      reads += 1;
      throw { code: 'terminal-host-unavailable-unreachable', reason: 'the host is offline', unblock: [] };
    },
  });
  try {
    await owned.terminal.read();
    owned.terminal.drop();
    owned.reconnect();
    owned.answered();
    await tick();
    expect(reads).toBe(1);
    expect(owned.terminal.pane).toBe(null);
  } finally {
    owned.stop();
  }
});

test('a closed CLI does not accept a record whose read was still in flight', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof listing>>();
  const owned = stand({ execution: THE_CLI, record: () => pending.promise });
  try {
    const reading = owned.terminal.read();
    owned.terminal.close();
    pending.resolve(listing(THE_CLI));
    await reading;
    expect(owned.terminal.pane).toBe(null);
    expect(owned.panes.pane(MINE)).toBe(null);
  } finally {
    owned.stop();
  }
});

test('a replacing host returns the CLI when its live inventory answers', async () => {
  let replacing = true;
  const owned = stand({
    execution: THE_CLI,
    record: (address) => {
      if (replacing)
        throw {
          code: 'terminal-host-state',
          reason: 'the execution host is being replaced; try the act again once it answers',
          unblock: [],
        };
      return listing(address);
    },
  });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'replacing' });
    replacing = false;
    owned.answered();
    await tick();
    expect(owned.terminal.pane?.address).toEqual(THE_CLI);
  } finally {
    owned.stop();
  }
});

const over = (execution: ExecutionAddress | null = null) =>
  ({
    ...row({ process: { id: 'session-1', state: 'ended', startedAt: '2026-09-18T00:00:00.000Z' } }),
    execution,
  }) as HarnessRowDetail;

test('a CLI whose process is over and named no pty draws its ending', async () => {
  const owned = stand({ harness: () => over() });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'ended', ending: null });
  } finally {
    owned.stop();
  }
});

test('a session that failed before its CLI started draws that failure, not connecting', async () => {
  const failure = 'launch-failed: the CLI was not started — ReferenceError: preparing is not defined';
  const owned = stand({
    harness: () => row({ process: { id: 'session-1', state: 'ended', startedAt: '2026-09-18T00:00:00.000Z', failure } }),
  });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'failed', failure });
  } finally {
    owned.stop();
  }
});

test('a session after an earlier CLI whose start is uncertain, then failed, draws its own state and reason over the earlier pane', async () => {
  const unknown = 'The start receipt is unknown; read operation harness-run:session-2.';
  const failed = 'unlaunched: the execution host holds no started process for this CLI, so it never ran — ' + unknown;
  let facet = $state.raw<HarnessRowDetail | null>({ ...row(), execution: THE_CLI } as HarnessRowDetail);
  const owned = stand({ execution: THE_CLI, harness: () => facet });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');
    pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
    const next = (state: string, failure: string) =>
      ({
        ...row({ process: { id: 'session-2', state, startedAt: '2026-09-18T00:02:00.000Z', failure } }),
        execution: null,
      }) as HarnessRowDetail;

    facet = next('uncertain', unknown);
    expect(owned.terminal.state).toEqual({ kind: 'uncertain', failure: unknown });
    facet = next('ended', failed);
    expect(owned.terminal.state).toEqual({ kind: 'failed', failure: failed });
  } finally {
    owned.stop();
  }
});

test('an ended process draws its ending above a record the host no longer answers', async () => {
  const owned = stand({
    execution: THE_CLI,
    harness: () => over(THE_CLI),
    record: () => {
      throw { code: 'terminal-record-lost', reason: 'the host holds nothing under that execution', unblock: [] };
    },
  });
  try {
    await owned.terminal.read();
    expect(owned.terminal.state).toEqual({ kind: 'ended', ending: null });
  } finally {
    owned.stop();
  }
});

test('settling an ended process ends the standing pane and clears its refusal', async () => {
  let facet = $state.raw<HarnessRowDetail | null>(row());
  const owned = stand({ execution: THE_CLI, harness: () => facet });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');
    pane.refusal = { message: 'cannot type: the host refused' };

    owned.terminal.settle();
    expect(pane.ending).toBe(null);

    facet = over(THE_CLI);
    owned.terminal.settle();
    expect(pane.ending).toEqual({ _tag: 'None' });
    expect(pane.refusal).toBe(null);
    expect(owned.terminal.state).toEqual({ kind: 'ended', ending: { _tag: 'None' } });
  } finally {
    owned.stop();
  }
});

test('a pane ended under a session that started again draws connecting, and the new pty clears the ending', async () => {
  const NEXT: ExecutionAddress = { execution: 'the-next-cli', incarnation: 0 };
  let facet = $state.raw<HarnessRowDetail | null>({ ...row(), execution: THE_CLI } as HarnessRowDetail);
  const owned = stand({ execution: THE_CLI, harness: () => facet });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');
    pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
    expect(owned.terminal.state.kind).toBe('ended');

    facet = {
      ...row({ process: { id: 'session-2', state: 'starting', startedAt: '2026-09-18T00:02:00.000Z' } }),
      execution: null,
    } as HarnessRowDetail;
    expect(owned.terminal.state).toEqual({ kind: 'connecting' });

    facet = {
      ...row({ process: { id: 'session-2', state: 'running', startedAt: '2026-09-18T00:02:00.000Z' } }),
      execution: NEXT,
    } as HarnessRowDetail;
    await owned.terminal.read(NEXT);
    expect(owned.terminal.pane).toBe(pane);
    expect(pane.ending).toBe(null);
  } finally {
    owned.stop();
  }
});

test('a terminal closed over its ended pty opens again on the next pty, even after the thread named none between', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    owned.terminal.close();
    await owned.terminal.read(null);
    expect(owned.terminal.state).toEqual({ kind: 'absent' });

    await owned.terminal.read({ execution: 'a-resumed-cli', incarnation: 0 });
    expect(owned.terminal.pane?.address).toEqual({ execution: 'a-resumed-cli', incarnation: 0 });
  } finally {
    owned.stop();
  }
});

test('the pane’s own ending and lost feed are each their own state', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    const pane = owned.terminal.pane;
    if (pane === null) throw new Error('the page raised no pane');

    pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 3 } };
    expect(owned.terminal.state).toEqual({
      kind: 'ended',
      ending: { _tag: 'Exit', native: { _tag: 'Code', code: 3 } },
    });

    pane.ending = null;
    pane.recovering = true;
    expect(owned.terminal.state).toEqual({ kind: 'lostFeed' });
  } finally {
    owned.stop();
  }
});

test('Close takes the pane out of the registry, and a new address raises a fresh one', async () => {
  const owned = stand({ execution: THE_CLI });
  try {
    await owned.terminal.read();
    const first = owned.terminal.pane;
    if (first === null) throw new Error('the page raised no pane');

    owned.terminal.close();
    expect(owned.terminal.pane).toBe(null);
    expect(owned.panes.pane(MINE)).toBe(null);

    await owned.terminal.read({ execution: 'a-relaunched-cli', incarnation: 0 });
    const again = owned.terminal.pane;
    if (again === null) throw new Error('the page raised no pane for the relaunched CLI');
    expect(again).not.toBe(first);
    expect(again.address).toEqual({ execution: 'a-relaunched-cli', incarnation: 0 });
  } finally {
    owned.stop();
  }
});

test('the open this page was handed is told its record, engine and attach stages', async () => {
  const stages: HarnessOpenStage[] = [];
  const attempt = {
    kind: 'harness',
    threadId: MINE,
    selectedAt: 0,
    recordAt: null,
    engineAt: null,
    attachAt: null,
    replayAt: null,
    paintAt: null,
    reached: (stage: HarnessOpenStage) => stages.push(stage),
    cancelFrame: null,
    cancelDeadline: () => undefined,
  } as unknown as HarnessOpenAttempt;
  const owned = stand({ execution: THE_CLI, attempt });
  try {
    await owned.terminal.read();
    expect(stages).toEqual(['record', 'engine', 'attach']);
  } finally {
    owned.stop();
  }
});
