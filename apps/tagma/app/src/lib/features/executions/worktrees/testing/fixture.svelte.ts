import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { PathRoads } from '$lib/features/checkout/PathRoads.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import type { ProcessReport } from '@runlith/executions/protocol/evidence';
import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Graph } from '@runlith/layer/Graph';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { tick } from 'svelte';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveStatus } from '$lib/wire/Live.js';
import type { WorktreeTerminals } from '../WorktreeTerminals.svelte.js';
import { TerminalAppearance } from '../../appearance/Settings.svelte.js';
import { TerminalHolders } from '../../terminal/Holders.svelte.js';
import { TerminalKeymap } from '../../terminal/Keymap.js';
import { LaneSockets } from '$lib/wire/LaneSockets.js';
import { TerminalOutput, pageHidden, pageTime } from '../../terminal/Output.js';
import type { TerminalPane } from '../../terminal/Pane.svelte.js';
import { Terminals } from '../Terminals.svelte.js';
import type { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { TabLayouts } from '$lib/app/panes/TabLayouts.svelte.js';
import type { PlacesPort } from '$lib/app/panes/ThreadPlaces.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import type { Resolver } from '@runlith/layer/key';
import { testArea } from '$lib/app/panes/testing.js';
import { testAddresses } from '$lib/app/testing.js';
import { panes as terminalKinds } from '../../panes.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { TerminalRenderPolicy } from '../../terminal/RenderPolicy.js';
import type { TerminalTab } from '../../terminal/Tab.svelte.js';
import { ExecutionsRepo, type ExecutionAddress } from '../../Repo.js';
import { ThreadNames, type OwnerWords } from '$lib/shared/threads/Names.svelte.js';

export const MAIN = 'root-main';
export const FEATURE = 'root-feature';
export const MAIN_FOLDER = '/root';
export const FEATURE_FOLDER = '/root/.worktrees/feature';

export const addressOf = (key: string): ExecutionAddress => {
  const cut = key.lastIndexOf(':');
  return { execution: key.slice(0, cut), incarnation: Number(key.slice(cut + 1)) };
};

type ListingShape = {
  readonly program?: string;
  readonly rootId?: string | null;
  readonly holder?: string;
  readonly heldBy?: string;
  readonly label?: string;
  readonly commandLine?: string;
  readonly launchedFor?: string;
  readonly adoptedBy?: string;
  readonly transport?: 'pty' | 'pipes';
  readonly phase?: string;
};

export const listingFor = (key: string, shape: ListingShape = {}) =>
  ({
    record: {
      execution: addressOf(key),
      revision: 7,
      program: shape.program ?? '/bin/zsh',
      cwd: shape.rootId === FEATURE ? FEATURE_FOLDER : MAIN_FOLDER,
      transport: shape.transport ?? 'pty',
      lifetime: 'held',
      holder: shape.holder ?? 'operator',
      heldBy: shape.heldBy,
      label: shape.label,
      commandLine: shape.commandLine,
      launchedFor: shape.launchedFor,
      adoptedBy: shape.adoptedBy,
      rootId: shape.rootId === null ? undefined : (shape.rootId ?? MAIN),
    },
    state: { phase: shape.phase ?? 'running' },
  }) as unknown as TerminalRow;

export const frames = (count: number): Promise<void> =>
  new Promise((done) => {
    let left = count;
    const step = (): void => {
      left -= 1;
      if (left <= 0) done();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

export const until = async (reached: () => boolean, what: string): Promise<void> => {
  for (let turn = 0; turn < 500; turn += 1) {
    if (reached()) return;
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error(`never reached: ${what}`);
};

export function stageFor(tab: TerminalTab): { helpers: Map<string, HTMLTextAreaElement>; remove: () => void } {
  const stage = document.createElement('div');
  stage.dataset.terminalTabId = tab.key;
  const helpers = new Map<string, HTMLTextAreaElement>();
  for (const id of tab.order) {
    const box = document.createElement('div');
    box.dataset.paneId = id;
    const helper = document.createElement('textarea');
    helper.className = 'xterm-helper-textarea';
    box.appendChild(helper);
    stage.appendChild(box);
    helpers.set(id, helper);
  }
  document.body.appendChild(stage);
  return { helpers, remove: () => stage.remove() };
}

export const standPane = (id: string, onFocus: () => void, grid: { cols: number; rows: number } | null = null): TerminalPane =>
  ({
    id,
    focus: onFocus,
    fit: () => undefined,
    reveal: () => undefined,
    measuredGrid: () => grid,
  }) as unknown as TerminalPane;

export const reportFor = (at: ExecutionAddress, busy: boolean): ProcessReport =>
  ({
    revision: 1,
    subject: { _tag: 'Execution', execution: { installation: 'test', ...at } },
    processes: [
      { identity: { pid: 100 }, association: { execution: { installation: 'test', ...at }, relation: 'leader', identity: 'same' } },
      ...(busy
        ? [
            {
              identity: { pid: 101 },
              association: { execution: { installation: 'test', ...at }, relation: 'work', identity: 'unknown' },
            },
          ]
        : []),
    ],
  }) as unknown as ProcessReport;

const FLOOR_SCREEN = { columns: 200, rows: 50 };

export type DoorStand = {
  readonly stored?: unknown;
  readonly entries?: readonly { readonly id: string; readonly value: unknown }[];
  readonly notice?: string | null;
  readonly os?: 'macos' | 'linux';
  readonly loseStart?: boolean;
  readonly loseStop?: boolean;
  readonly operationOf?: (operationId: string) => unknown;
  readonly quiet?: boolean;
  readonly ceiling?: { readonly rows: number; readonly columns: number };
  readonly processesOf?: (at: ExecutionAddress) => ProcessReport | undefined;
  readonly refuseInventory?: boolean;
  readonly project?: number;
  readonly records?: readonly TerminalRow[];
  readonly unlisted?: boolean;
  readonly adoptedBy?: (execution: string) => string | undefined;
  readonly threads?: (thread: string) => OwnerWords | null | undefined;
};

export type Stand = {
  readonly terminals: Terminals;
  readonly panes: SidePanes;
  readonly layouts: TabLayouts;
  readonly stops: { key: string; cause: unknown; heldAtStop: boolean }[];
  readonly writes: { projectId: number; key: string; value: unknown }[];
  readonly starts: { operationId: string; cwd: string; geometry?: { rows: number; columns: number } }[];
  readonly said: unknown[];
  readonly catalogKeys: (number | undefined)[];
  readonly addresses: string[];
  worktree(rootId?: string): WorktreeTerminals;
  aim(rootId: string | null): void;
  feed(listings: readonly TerminalRow[]): void;
  leave(rootId: string): void;
  list(): void;
  background(): void;
  reconnect(): void;
  stop(): void;
};

const rowOf = (rootId: string, kind: 'main' | 'tagma', branch: string, folder: string): WorktreePlace => ({
  index: kind === 'main' ? 0 : 1,
  rootId: rootId as WorktreePlace['rootId'],
  kind,
  name: branch,
  folder,
  branch,
  missing: false,
  hue: kind === 'main' ? null : 3,
  base: null,
  head: 'abcdef',
  headTime: 0,
  agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
  threads: [],
  setup: 'none',
  taskId: null,
  pending: null,
  movedAt: null,
});

export async function stand(listings: readonly TerminalRow[], door: DoorStand = {}): Promise<Stand> {
  const stops: Stand['stops'] = [];
  const writes: Stand['writes'] = [];
  const starts: Stand['starts'] = [];
  const said: unknown[] = [];
  const catalogKeys: (number | undefined)[] = [];
  const addresses: string[] = [];
  let losingStart = door.loseStart === true;
  let losingStop = door.loseStop === true;
  let refusingInventory = door.refuseInventory === true;
  const projectId = door.project ?? 1;
  const os = door.os ?? 'linux';
  let shells = 0;
  const known = [...listings, ...(door.records ?? [])];
  const recordOf = (at: ExecutionAddress) => {
    const record = (
      known.find((held) => held.record.execution.execution === at.execution && held.record.execution.incarnation === at.incarnation) ??
      listingFor(`${at.execution}:${at.incarnation}`)
    ).record;
    const adoptedBy = door.adoptedBy?.(at.execution);
    return adoptedBy === undefined ? record : { ...record, adoptedBy };
  };
  const repo = {
    inventory: {
      key: () => ({
        refresh: async () => {
          if (refusingInventory) {
            refusingInventory = false;
            throw { code: 'host-unavailable', reason: 'the roster could not be read', unblock: ['try again'] };
          }
          return {
            terminals: listings,
            next: null,
            total: listings.length,
            notice: door.notice ?? null,
            geometry: door.ceiling ?? FLOOR_SCREEN,
          };
        },
      }),
    },
    processes: {
      key: (at: ExecutionAddress) => ({
        refresh: async () => ({ report: door.processesOf === undefined ? reportFor(at, true) : door.processesOf(at) }),
      }),
    },
    record: {
      key: (at: ExecutionAddress) => ({ refresh: async () => ({ record: recordOf(at), state: { phase: 'running' } }) }),
    },
    operation: {
      key: (operationId: string) => ({
        refresh: async () => door.operationOf?.(operationId) ?? { _tag: 'Whole', state: { _tag: 'Unknown', operation: {} } },
      }),
    },
    start: {
      run: async (input: { operationId: string; cwd: string; geometry?: { rows: number; columns: number } }) => {
        starts.push(input.geometry === undefined ? { operationId: input.operationId, cwd: input.cwd } : { ...input });
        if (losingStart) {
          losingStart = false;
          throw new Error('the start reply never arrived');
        }
        shells += 1;
        return { operation: { _tag: 'Digest', digest: { execution: addressOf(`fresh-${shells}:0`) } } };
      },
    },
    stop: {
      run: async (input: ExecutionAddress & { cause: unknown }) => {
        const key = `${input.execution}:${input.incarnation}`;
        stops.push({ key, cause: input.cause, heldAtStop: terminals.rootOf(key) !== null });
        if (losingStop) {
          losingStop = false;
          throw new Error('the stop reply never arrived');
        }
      },
    },
  };
  const settings = {
    catalog: {
      key: (key?: number) => {
        catalogKeys.push(key);
        return {
          watch: () => ({ entries: door.entries ?? [], sections: [], rejections: [] }),
          refresh: async () => ({
            entries: [...(door.stored === undefined ? [] : [{ id: 'terminal.placeLayouts', value: door.stored }]), ...(door.entries ?? [])],
            sections: [],
            rejections: [],
          }),
        };
      },
    },
    write: {
      data: undefined,
      run: async (input: { projectId: number; key: string; value: unknown }) => {
        writes.push(input);
        return undefined;
      },
      in() {
        return this;
      },
    },
  };
  const loud = (...args: unknown[]) => {
    console.error('stand refusal:', ...args);
    throw args[0] instanceof Error ? args[0] : new Error('refusal in stand');
  };
  const quiet = (...args: unknown[]) => {
    said.push(args[args.length - 1]);
  };
  const notices = door.quiet === true ? { error: quiet, refusal: quiet } : { error: loud, refusal: loud };

  let rows = $state.raw<readonly WorktreePlace[]>([
    rowOf(MAIN, 'main', 'main', MAIN_FOLDER),
    rowOf(FEATURE, 'tagma', 'feature', FEATURE_FOLDER),
  ]);
  let aimed = $state<string | null>(MAIN);
  let listed = $state(door.unlisted !== true);
  const worktrees = {
    get rows() {
      return rows;
    },
    get known() {
      return listed;
    },
    unread: null,
    get aimed() {
      return rows.find((row) => row.rootId === aimed) ?? null;
    },
    byRoot: (rootId: string) => rows.find((row) => row.rootId === rootId) ?? null,
    placeOf: () => rows.find((row) => row.rootId === MAIN) ?? null,
    folderOf: (row: WorktreePlace | null) => (row === null || row.missing ? null : row.folder),
  };
  const readings = new Set<() => void>();
  const commands = $state({
    roster: [] as readonly TerminalRow[],
    onReading: (listener: () => void) => {
      readings.add(listener);
      return () => readings.delete(listener);
    },
  });
  const focus = $state({ current: true });
  let url = new URL('http://tagma.test/proj/chat/thread-1');
  const router = {
    params: { project: 'proj' },
    get url() {
      return url;
    },
    replace: async (href: string) => {
      addresses.push(href);
      url = new URL(href, url);
    },
  };
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    keys: () => [],
    watch: () => () => undefined,
  };

  const statuses = new Set<(status: LiveStatus) => void>();
  const live = {
    subscribeStatus: (listener: (status: LiveStatus) => void) => {
      statuses.add(listener);
      listener('open');
      return () => statuses.delete(listener);
    },
  };
  let terminals!: Terminals;
  const { panes, layouts } = testArea(terminalKinds, storage, { resolve: () => terminals } as unknown as Resolver);
  panes.seatMain({ activeId: 'thread-1', projectId });
  const places: PlacesPort = {
    place: (at, thread) => ({ layouts: at, holder: threadHolder(thread) }),
    openFor: (at, thread, content, how) => panes.openAt({ layouts: at, holder: threadHolder(thread) }, content, how),
    ask: () => {
      throw new Error('asking a thread is not part of this case');
    },
  };
  const lifetimes: Scope[] = [];
  const stopEffects = $effect.root(() => {
    const scope = Scope.make('places-test');
    lifetimes.push(scope);
    const graph = new Graph(
      Layer.mergeAll(
        Layer.of(ExecutionsRepo, repo as never),
        Layer.of(TerminalHolders, new TerminalHolders(() => [], ThreadNames.make())),
        Layer.of(ThreadNames, new ThreadNames(door.threads ?? (() => undefined))),
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
        Layer.of(TerminalAppearance, { activeTab: null, paneBackground: 'transparent', paneStyle: () => ({}) } as never),
        Layer.of(Notices, notices as never),
        Layer.of(Host, new Host('tab', os)),
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
        Layer.of(ProjectDoor, {} as never),
        Layer.of(TerminalOutput, new TerminalOutput(pageTime(), pageHidden, scope)),
        Layer.of(TerminalKeymap, new TerminalKeymap(new Host('tab', 'linux'))),
        Layer.of(Worktrees, worktrees as never),
      ),
      {
        ladder: [ProjectRung],
        effectRoot: (build) => $effect.root(build),
      },
    );
    const app = Scope.make('places-app');
    lifetimes.push(app);
    void graph.open(app);
    const rung = graph.openRung(app, ProjectRung, { projectId });
    void rung.ready;
    terminals = new Terminals(
      projectId,
      repo as never,
      notices as never,
      settings as never,
      worktrees as never,
      commands as never,
      router as never,
      testAddresses(router as never),
      focus as never,
      panes,
      places,
      layouts,
      rung.scope.child('Terminals'),
      live as never,
    );
  });
  await tick();
  await until(() => terminals.inventory._tag !== 'reading', 'the reading the terminals start on their own');
  return {
    terminals,
    panes,
    layouts,
    stops,
    writes,
    starts,
    said,
    catalogKeys,
    addresses,
    worktree: (rootId = MAIN) => {
      const worktree = terminals.worktrees.get(rootId);
      if (worktree === undefined) throw new Error(`no worktree's terminals stand at ${rootId}`);
      return worktree;
    },
    aim: (rootId) => {
      aimed = rootId;
    },
    feed: (next) => {
      commands.roster = next;
      for (const hear of readings) hear();
    },
    leave: (rootId) => {
      rows = rows.filter((row) => row.rootId !== rootId);
    },
    list: () => {
      listed = true;
    },
    background: () => {
      focus.current = false;
    },
    reconnect: () => {
      for (const status of ['closed', 'open'] as const) for (const hear of statuses) hear(status);
    },
    stop: () => {
      stopEffects();
      for (const life of lifetimes) void life.close();
    },
  };
}
