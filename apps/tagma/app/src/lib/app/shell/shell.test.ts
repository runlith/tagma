// @vitest-environment jsdom
import { Router, type RouterSource } from '@runlith/layer/Router';
import { makeStorage } from '@runlith/layer/testing';
import { Effect } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { ThreadsRepo } from '$lib/features/threads/Repo.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import {
  NavigationFailed,
  PaneUnavailable,
  ProjectUnknown,
  type ShellPort,
  shellActs,
  SurfaceNotDeclared,
  ThreadGone,
} from '$lib/features/workspace/ShellOps.js';
import { type SurfaceDeclaration, SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { Refusal } from '$lib/wire/refusal.js';

import { Failure } from '@runlith/layer/Failure';
import type { DesktopWindows } from '@tagma/desktop/bridge';
import { type PrepareRung, ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
import { MainWindowShell } from '$lib/features/tagma-apps/windows/MainWindowShell.js';
import { THREAD_PANE } from '$lib/features/threads/seats/pane.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { testArea, testKind } from '../panes/testing.js';
import { DesktopShell } from './DesktopShell.js';
import { MobileShell } from './MobileShell.js';

const icon = (() => undefined) as unknown as SurfaceDeclaration['icon'];

const surfaces = new SurfaceRegistry([
  { surface: 'chat', route: 'chat', label: 'Agents', icon, rail: 1, home: true, stands: 'project', remembers: true },
  { surface: 'notes', route: 'notes', label: 'Notes', icon, rail: 2, stands: 'graph', remembers: true },
]);

function world(standing: readonly string[] = ['t1', 't9'], goto: (href: string) => Promise<void> = async () => undefined) {
  const went: string[] = [];
  const source = {
    goto: async (href: string) => {
      went.push(href);
      await goto(href);
    },
    url: () => new URL('https://tagma.test/runlith/chat'),
    params: () => ({ project: 'runlith' }),
    routeId: () => undefined,
  } as unknown as RouterSource;
  const router = new Router(source);
  const addresses = new Addresses(router, surfaces);
  const loaded = [
    { id: 1, name: 'runlith' },
    { id: 2, name: 'orbit' },
  ];
  const registered = [...loaded, { id: 3, name: 'polygon' }];
  const workspace = {
    projects: loaded,
    projectsOf: async (ids: readonly number[]) =>
      ids.map((id) => {
        const project = registered.find((one) => one.id === id);
        if (project === undefined)
          throw new Refusal({ gate: false, code: 'unknown-project', reason: `project ${id} is not registered`, unblock: [] });
        return project;
      }),
    activeId: 1,
    contextProject: { id: 1, name: 'runlith' },
  } as unknown as Workspace;
  const visits = new Visits(makeStorage(), surfaces);
  const prepared: string[] = [];
  const prepare = (async (rung: { name: string }, input: object) => {
    prepared.push(`${rung.name} ${JSON.stringify(input)}`);
    went.push(`prepared ${rung.name}`);
  }) as unknown as PrepareRung;
  const prefetch = new ProjectPrefetch(prepare, visits, new Failure(() => undefined));
  const threads = {
    list: {
      key: (aim: { selection: { ids: string } }) => ({
        refresh: async () => ({ status: 'rows', rows: standing.filter((id) => id === aim.selection.ids).map((id) => ({ id })) }),
      }),
    },
  } as unknown as ReturnType<typeof ThreadsRepo.use>;
  const { panes } = testArea([testKind(THREAD_PANE)]);
  const seats = new ThreadSeats(panes);
  panes.showSection('chat');
  const shown: string[] = [];
  const notices = { error: (title: string, body: string) => shown.push(`${title}: ${body}`) } as unknown as Notices;
  const revealed: string[] = [];
  const windows = { reveal: (path: string) => void revealed.push(path) } as unknown as DesktopWindows;
  return {
    went,
    shown,
    panes,
    notices,
    visits,
    prepared,
    revealed,
    desktop: new DesktopShell(router, workspace, visits, surfaces, addresses, threads, prefetch, panes, seats),
    mobile: new MobileShell(router, workspace, visits, surfaces, addresses, threads, prefetch) as ShellPort,
    window: new MainWindowShell(windows, workspace, visits, addresses) as ShellPort,
  };
}

const failure = <A, E>(result: { readonly _tag: string; readonly failure?: E } | { readonly _tag: 'Success'; readonly success: A }) =>
  result._tag === 'Failure' ? (result as { failure: E }).failure : undefined;

it.live('a thread opened beside in the standing project takes a pane once, and a second opening reveals it instead of doubling it', () =>
  Effect.gen(function* () {
    const { desktop, panes, went } = world();

    yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 't1' }, 'beside'));
    yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 't1' }, 'beside'));

    expect(panes.panes.map((pane) => pane.id)).toEqual(['t1']);
    expect(went).toEqual([]);
  }),
);

it.live('a thread the main slot already shows is revealed there, not refused and not doubled', () =>
  Effect.gen(function* () {
    const { desktop, panes } = world();
    panes.seatMain({ activeId: 't1', projectId: 1 });

    const result = yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 't1' }, 'beside'));

    expect(result._tag).toBe('Success');
    expect(panes.panes).toEqual([]);
  }),
);

it.live('beside is offered to open a free thread, to show one standing in a tab, and not at all to one the main slot shows', () =>
  Effect.gen(function* () {
    const { desktop, mobile, panes } = world();
    const address = { projectId: 1, threadId: 't1' };
    expect(desktop.besideOffer(address)).toBe('open');

    yield* Effect.result(desktop.openThread(address, 'beside'));
    expect(desktop.besideOffer(address)).toBe('show');

    panes.close(panes.panes[0]!.key);
    panes.seatMain({ activeId: 't1', projectId: 1 });
    expect(desktop.besideOffer(address)).toBe('none');
    expect(mobile.besideOffer(address)).toBe('none');
  }),
);

it.live('a thread of another project opens beside in a pane that names its home, and main goes to its project', () =>
  Effect.gen(function* () {
    const { desktop, panes, went } = world();

    yield* Effect.result(desktop.openThread({ projectId: 2, threadId: 't9' }, 'beside'));
    yield* Effect.result(desktop.openThread({ projectId: 2, threadId: 't9' }, 'beside'));
    expect(panes.panes.map((pane) => pane.id)).toEqual(['2:t9']);
    expect(went).toEqual([]);

    yield* Effect.result(desktop.openThread({ projectId: 2, threadId: 't9' }, 'main'));
    expect(went).toEqual(['/orbit/chat/t9']);
  }),
);

it.live('a thread homed in a project registered after the app loaded opens in that project', () =>
  Effect.gen(function* () {
    const { desktop, went } = world();

    const result = yield* Effect.result(desktop.openThread({ projectId: 3, threadId: 't9' }, 'main'));

    expect(result._tag).toBe('Success');
    expect(went).toEqual(['/polygon/chat/t9']);
  }),
);

it.live('a thread its owner no longer holds is refused before any placement or navigation', () =>
  Effect.gen(function* () {
    const { desktop, mobile, panes, went } = world(['t1']);

    const beside = yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 'deleted' }, 'beside'));
    const main = yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 'deleted' }, 'main'));
    const small = yield* Effect.result(mobile.openThread({ projectId: 1, threadId: 'deleted' }, 'main'));

    for (const refused of [beside, main, small]) expect(failure(refused)).toBeInstanceOf(ThreadGone);
    expect(panes.panes).toEqual([]);
    expect(went).toEqual([]);
  }),
);

it.live('a project nobody registered, a pane kind nobody declared and a surface nobody declared are typed refusals', () =>
  Effect.gen(function* () {
    const { desktop } = world();

    const project = yield* Effect.result(desktop.openThread({ projectId: 7, threadId: 't1' }, 'main'));
    const pane = yield* Effect.result(desktop.openPane('unknown', null));
    const surface = yield* Effect.result(desktop.revealSurface('nowhere'));

    expect(failure(project)).toBeInstanceOf(ProjectUnknown);
    expect(failure(pane)).toBeInstanceOf(PaneUnavailable);
    expect(failure(surface)).toBeInstanceOf(SurfaceNotDeclared);
  }),
);

it.live('a surface is revealed at the place the visit remembers for it', () =>
  Effect.gen(function* () {
    const { desktop, went } = world();

    yield* Effect.result(desktop.revealSurface('notes'));

    expect(went).toEqual(['/runlith/notes']);
  }),
);

it.live('the mobile shell opens a thread beside in its one slot and has no side pane to open', () =>
  Effect.gen(function* () {
    const { mobile, went } = world();

    yield* Effect.result(mobile.openThread({ projectId: 1, threadId: 't1' }, 'beside'));
    const pane = yield* Effect.result(mobile.openPane(THREAD_PANE, 't1'));

    expect(went).toEqual(['/runlith/chat/t1']);
    expect(failure(pane)).toBeInstanceOf(PaneUnavailable);
  }),
);

it.live('a project opens at its last place in every shell, the main window’s own included, after its rungs are prepared', () =>
  Effect.gen(function* () {
    const { desktop, mobile, window, visits, went, prepared, revealed } = world();
    visits.remember({ id: 2, name: 'orbit' } as never, 'notes', 'alpha', 'feature');

    yield* Effect.result(desktop.openProject(2, 'strip'));
    yield* Effect.result(mobile.openProject(2, 'palette'));
    yield* Effect.result(window.openProject(2, 'keys'));
    const unknown = yield* Effect.result(desktop.openProject(7, 'menu'));

    const place = '/orbit/notes/alpha?branch=feature';
    expect(went).toEqual(['prepared project', 'prepared graph', place, 'prepared project', 'prepared graph', place]);
    expect(prepared).toContain('graph {"projectId":2,"branch":"feature"}');
    expect(revealed).toEqual([place]);
    expect(failure(unknown)).toBeInstanceOf(ProjectUnknown);
  }),
);

it.live('a navigation that rejects is a typed refusal, and the operator is told through a notice', () =>
  Effect.gen(function* () {
    const { desktop, notices, shown } = world(['t1'], () => Promise.reject(new Error('The route did not load.')));

    const result = yield* Effect.result(desktop.openThread({ projectId: 1, threadId: 't1' }, 'main'));
    expect(failure(result)).toBeInstanceOf(NavigationFailed);

    yield* Effect.promise(() => shellActs(desktop, notices).openThread({ projectId: 1, threadId: 't1' }, 'main'));
    expect(shown).toEqual(['Could not open: The route did not load.']);
  }),
);
