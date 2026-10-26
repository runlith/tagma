import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { PathFile } from '@tagma/server/checkout-files/contract/wire/place';
import { makeRouter } from '@runlith/layer/testing';
import { expect, test, vi } from 'vitest';
import { testDoor } from '$lib/wire/testing.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import { besideOf } from '$lib/app/opening/beside.js';
import { testAddresses } from '$lib/app/testing.js';
import { FILE_PANE, fileTargetOf } from '../paneContent.js';
import { FileOpener, type Located } from './FileOpener.svelte.js';

const OWN = 'root-own' as RootId;
const OTHER = 'root-other' as RootId;
const AIM = { projectId: 1, branch: 'main' };

const FOREIGN = 'root-foreign' as RootId;

type Placed = { projectId: number; checkout: RootId; root: string; path: string } | null;

function standing(place: Placed, options: { aim?: () => typeof AIM; surface?: boolean; held?: Promise<void>; file?: PathFile } = {}) {
  const asked: unknown[] = [];
  const gone: string[] = [];
  const errors: string[] = [];
  const { panes } = testArea([testKind(FILE_PANE)]);
  const seats = new ThreadSeats(panes);
  const router = makeRouter({
    params: { project: 'runlith' },
    url: new URL('https://tagma.test/runlith'),
    goto: async (href) => void gone.push(href),
  });
  const opener = new FileOpener(
    Object.assign(testDoor(), {
      perform: async (_id: string, input: unknown) => {
        asked.push(input);
        await options.held;
        return {
          entry:
            options.file ??
            (place === null ? null : { kind: 'file', path: `${place.root}/${place.path}`, bytes: 1, mediaType: 'text/plain' }),
          place,
        };
      },
    }) as never,
    options.aim ?? (() => AIM),
    {
      list: { loadOrThrow: () => Promise.resolve([{ id: 2, name: 'other' }]) },
      branches: {
        key: (projectId: number) => ({
          loadOrThrow: () =>
            Promise.resolve(
              projectId === 2
                ? [{ branch: 'main', worktree: '/work/other', canonical: true }]
                : [{ branch: 'feature', worktree: '/work/feature', canonical: false }],
            ),
        }),
      },
    } as never,
    router,
    testAddresses(router),
    { error: (_title: string, body: string) => void errors.push(body), refusal: vi.fn() } as never,
    { open: () => undefined },
    besideOf(panes, seats),
  );
  const shown: Located[] = [];
  if (options.surface !== false) opener.stand(AIM, { rootId: () => OWN, show: (located) => void shown.push(located) });
  const tabbed = () => panes.layouts?.layout(threadHolder('thread-1')).tabs.map((tab) => fileTargetOf(tab.id)) ?? [];
  return { opener, asked, gone, errors, shown, tabbed };
}

test('a path from a chat opens as a file tab beside its thread, the same file again turns to that tab at the new line, and the page stays where it is', async () => {
  const world = standing({ projectId: 1, checkout: OWN, root: '/work/main', path: 'src/a.ts' });

  await world.opener.open({ path: '/work/main/src/a.ts', line: 12, column: 3 }, { beside: { thread: 'thread-1' } });
  await world.opener.open({ path: '/work/main/src/a.ts', line: 40 }, { beside: { thread: 'thread-1' } });

  expect(world.tabbed()).toEqual([{ projectId: 1, rootId: OWN, path: 'src/a.ts', at: { line: 40, column: null } }]);
  expect(world.shown).toEqual([]);
  expect(world.gone).toEqual([]);
});

test('a path from anywhere else opens in a tab of the checkout and brings the checkout forward; a file of another worktree is marked by its branch', async () => {
  const own = standing({ projectId: 1, checkout: OWN, root: '/work/main', path: 'src/a.ts' });
  await own.opener.open({ path: 'src/a.ts' }, { from: '/work/main' });
  expect(own.asked).toEqual([{ path: 'src/a.ts', from: '/work/main' }]);
  expect(own.shown).toEqual([{ rootId: OWN, projectId: 1, path: 'src/a.ts', branch: null, line: null, column: null }]);
  expect(own.gone).toHaveLength(1);

  const other = standing({ projectId: 1, checkout: OTHER, root: '/work/feature', path: 'lib/b.ts' });
  await other.opener.open({ path: '/work/feature/lib/b.ts', line: 4 });
  expect(other.shown[0]).toMatchObject({ rootId: OTHER, branch: 'feature', line: 4 });
});

test("a file of another project's checkout opens in that project's checkout page, which receives it once it stands", async () => {
  const world = standing({ projectId: 2, checkout: FOREIGN, root: '/work/other', path: 'x.ts' });
  await world.opener.open({ path: '/work/other/x.ts', line: 2 });
  expect(world.shown).toEqual([]);
  expect(world.gone).toHaveLength(1);
  expect(world.gone[0]).toContain('/other');

  const there: Located[] = [];
  world.opener.stand({ projectId: 2, branch: null }, { rootId: () => FOREIGN, show: (located) => void there.push(located) });
  expect(there).toEqual([{ rootId: FOREIGN, projectId: 2, path: 'x.ts', branch: null, line: 2, column: null }]);
});

test('a file in a checkout of another project that its page lists under no branch opens nothing there and says so', async () => {
  const world = standing({ projectId: 2, checkout: FOREIGN, root: '/work/other-detached', path: 'x.ts' });
  await world.opener.open({ path: '/work/other-detached/x.ts' });
  expect(world.gone).toEqual([]);
  expect(world.errors).toHaveLength(1);
  const there: Located[] = [];
  world.opener.stand({ projectId: 2, branch: null }, { rootId: () => FOREIGN, show: (located) => void there.push(located) });
  expect(there).toEqual([]);
});

test('an absent file opens nothing and produces no error toast', async () => {
  const world = standing(null);

  await world.opener.open({ path: '/elsewhere/x.ts' });

  expect(world.shown).toEqual([]);
  expect(world.gone).toEqual([]);
  expect(world.errors).toHaveLength(0);
});

test('a file outside every project checkout opens as a file tab by its absolute path, and a picture goes to the asker that shows pictures', async () => {
  const file = { kind: 'file' as const, path: '/other-project/scratch/report.md', bytes: 40, mediaType: 'text/markdown' };
  const world = standing(null, { file });
  await world.opener.open({ path: file.path, line: 3 }, { beside: { thread: 'thread-1' } });
  expect(world.tabbed()).toEqual([{ projectId: null, rootId: null, path: file.path, at: { line: 3, column: null } }]);

  const picture = { kind: 'file' as const, path: '/tmp/shot.png', bytes: 10, mediaType: 'image/png' };
  const shown: unknown[] = [];
  const pictured = standing(null, { file: picture });
  await pictured.opener.open({ path: picture.path }, { beside: { thread: 'thread-1' }, picture: (one) => void shown.push(one) });
  expect(shown).toEqual([
    { url: 'http://localhost/api/files/preview?path=%2Ftmp%2Fshot.png&full=true', name: 'shot.png', mediaType: 'image/png' },
  ]);
  expect(pictured.tabbed()).toEqual([]);
});

test('an answer that arrives after the page moved to another branch opens nothing', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let aim = AIM;
  const world = standing({ projectId: 1, checkout: OWN, root: '/work/main', path: 'src/a.ts' }, { aim: () => aim, held });

  const opening = world.opener.open({ path: '/work/main/src/a.ts' });
  aim = { projectId: 1, branch: 'feature' };
  release();
  await opening;

  expect(world.shown).toEqual([]);
  expect(world.gone).toEqual([]);
});
