// @vitest-environment jsdom
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import type { CheckoutArea, CheckoutEntry, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Layer } from '@runlith/layer/Layer';
import { makeRouter } from '@runlith/layer/testing';
import { stubFamily, stubMutation, stubSingle } from '@runlith/query/testing';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { UserSettings } from '$lib/features/settings/UserSettings.svelte.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
import { keyedBy, liveFeed, mountShell, testAim, testLinks, testPlaces, testShellOps, type TestApp } from '$lib/app/testing.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Holdings } from '$lib/features/checkout/Holdings.svelte.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import type { GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Live } from '$lib/wire/Live.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { testProviderCatalog } from '$lib/features/providers/testing.js';

const SHIPPED = testProviderCatalog();
import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
import type { AwakeState } from '@tagma/server/power/contract/wire/power';
import { Awake } from '$lib/features/power/Awake.svelte.js';
import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
import { TerminalKeymap } from '$lib/features/executions/terminal/Keymap.js';
import { defaultKeys, terminalKeymap } from '$lib/features/executions/terminal/testing/keys.svelte.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
import { View } from '$lib/features/executions/load/View.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Restart } from '$lib/wire/Restart.svelte.js';
import { ServerFaults } from './ServerFaults.svelte.js';
import { Standing } from './Standing.svelte.js';
import StatusBar from './StatusBar.svelte';
import { WireState } from './WireState.svelte.js';
import { Host } from '@runlith/layer/Host';
import { Opening } from '$lib/features/opening/Opening.svelte.js';

const host = $state({
  modelSettings: null as { provider: string; account: string } | null,
  activeThread: null as { provider: string; account: string } | null,
  applyAccount: vi.fn(),
});

const table = $state({ rows: [] as readonly AccountQuotaRow[], known: false });
const accounts = {
  get rows() {
    return table.rows;
  },
  get known() {
    return table.known;
  },
  get providers() {
    return [...new Set(table.rows.map((row) => row.provider))].map((provider) => {
      const rows = table.rows.filter((row) => row.provider === provider);
      return { provider, served: SHIPPED.provider(provider), rows, standing: rows[0] as AccountQuotaRow };
    });
  },
  of: (provider: string) => table.rows.filter((row) => row.provider === provider),
} as unknown as UsageAccounts;

const standing = $state({
  health: null as unknown,
  machine: null as unknown,
  readAt: null as number | null,
  acting: null as unknown,
  quietSince: null as number | null,
  ready: null as string | null,
  restarting: null as string | null,
  problem: null as string | null,
  act: () => null,
  read: () => Promise.resolve(),
  restart: () => Promise.resolve(),
  update: () => Promise.resolve(),
  build: () => Promise.resolve(),
});

const restart = $state({ since: null as number | null, quietSince: null as number | null });

const awake = $state({
  standing: null as AwakeState | null,
  choosing: null as string | null,
  problem: null as string | null,
  choose: () => Promise.resolve(),
});

let feed = liveFeed();

const NOW = Date.parse('2026-09-02T12:00:00Z');
const HOUR = 3_600_000;

const area = (entries: readonly CheckoutEntry[], added = 0, removed = 0): CheckoutArea => ({
  entries,
  added,
  removed,
});

const changed = (path: string): CheckoutEntry => ({
  path,
  status: 'modified',
  lines: { added: 1, removed: 1 },
});

function checkoutRow(over: Partial<CheckoutState> = {}): CheckoutState {
  return {
    rootId: 'root-1',
    path: '/repo',
    revision: 1,
    head: 'f1e2d3c4b5a6',
    ref: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    operation: 'none',
    entries: { staged: area([]), unstaged: area([]), untracked: area([]), unmerged: area([]) },
    compare: null,
    coverage: { untracked: 'all', paths: null },
    repository: true,
    incomplete: false,
    stale: false,
    unwatched: false,
    slowStatus: false,
    ...over,
  } as CheckoutState;
}

function sent(row: CheckoutState): void {
  const frame = feed.routes.get('checkout.subscribe');
  if (frame === undefined) throw new Error('The checkout store holds no subscription.');
  frame(row);
  flushSync();
}

function account(
  provider: AccountQuotaRow['provider'],
  key: string,
  windows: readonly QuotaWindow[],
  fields: Partial<AccountQuotaRow> = {},
): AccountQuotaRow {
  return {
    provider,
    account: key,
    label: `${key}@runlith.dev`,
    origin: { kind: 'own' },
    default: true,
    quota: new QuotaObservation({ observedAt: new Date(NOW), source: 'usage', windows }),
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    lent: [],
    ...fields,
  } as AccountQuotaRow;
}

let app: TestApp | undefined;

beforeEach(() => {
  table.rows = [];
  table.known = false;
  host.modelSettings = null;
  host.activeThread = null;
  standing.health = null;
  standing.quietSince = null;
  standing.ready = null;
  standing.restarting = null;
  standing.problem = null;
  awake.standing = null;
  feed = liveFeed();
});

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
  vi.useRealTimers();
});

function draw(options: { at?: GraphAim | undefined } = {}): HTMLElement {
  vi.useFakeTimers({ now: NOW });
  app = mountShell(
    Layer.mergeAll(CountdownClock, WallClock, Notices, UserSettings, Checkout, Holdings, ReaderMarks, Readings, View, ExecutionActs),
    Layer.mergeAll(
      Layer.of(Door, { ask: () => Promise.reject(new Error('this suite makes no call')) } as never),
      Layer.of(Workspace, { projects: [], contextProject: null } as never),
      Layer.of(SettingsRepo, { catalog: stubFamily(), write: stubMutation() } as never),
      Layer.of(UsageAccounts, accounts),
      Layer.of(ProviderCatalog, SHIPPED),
      Layer.of(Standing, standing as never),
      Layer.of(Restart, restart as never),
      Layer.of(Awake, awake as never),
      Layer.of(ServerFaults, { page: null, clearing: false, clear: () => Promise.resolve() } as never),
      Layer.of(Terminals, { home: null, shown: false, count: () => 0, toggle: () => undefined } as never),
      Layer.of(TerminalKeymap, terminalKeymap(new Host('tab', 'linux'))),
      Layer.of(Keymap, defaultKeys(new Host('tab', 'linux'))),
      testShellOps,
      Layer.of(
        Opening,
        new Opening(testLinks([], []), {} as never, {} as never, { refusal: vi.fn() } as never, new Host('desktop', 'macos')),
      ),
      WireState,
      Layer.of(ThreadOnScreen, {
        page: null,
        get host() {
          return host;
        },
      } as never),
      Layer.of(AccountsRepo, { refresh: stubMutation(), useByDefault: stubMutation() } as never),
      Layer.of(Live, feed.live),
      Layer.of(ProjectsRepo, { branches: keyedBy(async () => []) } as never),
      Layer.of(Worktrees, testPlaces() as never),
    ),
    {
      ...options,
      router: makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith'), routeId: '/[project]' }),
    },
  );
  const mountPoint = app.draw(StatusBar as never);
  flushSync();
  const bar = mountPoint.querySelector('[data-status-bar]');
  if (!(bar instanceof HTMLElement)) throw new Error('No status bar drawn.');
  return bar;
}

test('each provider’s segment fills its gauge to its own tightest window', () => {
  table.rows = [
    account('subscription', 'a1', [new QuotaWindow({ kind: 'model', label: 'Fable', usedPercent: 78, resetsAt: (NOW + 4 * HOUR) / 1000 })]),
    account('openai-oauth', 'o1', [new QuotaWindow({ kind: 'session', usedPercent: 14, resetsAt: (NOW + 30 * HOUR) / 1000 })]),
  ];
  table.known = true;

  const bar = draw();

  expect([...bar.querySelectorAll('[data-gauge]')].map((gauge) => gauge.getAttribute('data-fill'))).toEqual(['78', '14']);
  expect(bar.querySelectorAll('[data-usage-segment]')).toHaveLength(2);
});

test('the bar stands without a table and its tenant says nothing until one arrives', () => {
  const bar = draw();
  expect(bar.querySelector('[data-usage-meters]')).toBeNull();

  table.rows = [account('acme-oauth', 'x1', [new QuotaWindow({ kind: 'weekly', usedPercent: 12 })])];
  table.known = true;
  flushSync();
  expect(bar.querySelector('[data-usage-segment="acme-oauth"] [data-gauge]')?.getAttribute('data-fill')).toBe('12');
});

test('the standing chip says a dropped connection before the server, and stops saying it once the connection is open', () => {
  const bar = draw();
  feed.status?.('closed');
  flushSync();
  expect(bar.querySelector('[data-standing-chip]')?.getAttribute('data-standing-chip')).toBe('bad');
  expect(bar.querySelector('[data-standing-word]')?.textContent).toContain('offline');

  feed.status?.('open');
  flushSync();
  expect(bar.querySelector('[data-standing-word]')).toBeNull();
});

test('the checkout segment carries the row the socket sent, and nothing before one arrives', () => {
  const bar = draw();
  expect(bar.querySelector('[data-checkout-tenant]')).toBeNull();

  sent(checkoutRow({ ref: 'main', ahead: 2, behind: 1 }));

  const said = (name: string) => bar.querySelector(`[data-checkout-${name}]`)?.getAttribute(`data-checkout-${name}`) ?? null;
  expect([said('head'), said('ahead'), said('behind')]).toEqual([null, '2', '1']);

  sent(checkoutRow({ revision: 2, ref: null }));
  expect(bar.querySelector('[data-checkout-head]')?.textContent?.trim()).toBe('detached at f1e2d3c');
  expect([said('ahead'), said('behind')]).toEqual([null, null]);
});

test('the checkout segment sums the lines of the row’s code paths, leaves the graph’s tree out, and says clean when nothing changed', () => {
  const bar = draw();
  sent(
    checkoutRow({
      entries: {
        staged: area([{ ...changed('a.ts'), lines: { added: 4, removed: 1 } }]),
        unstaged: area([{ ...changed('b.ts'), lines: { added: 2, removed: 3 } }, changed('.tagma/blocks/one.md')]),
        untracked: area([]),
        unmerged: area([]),
      },
    }),
  );
  const paths = bar.querySelector('[data-checkout-paths]');
  expect([paths?.getAttribute('data-checkout-paths'), paths?.textContent?.replace(/\s+/g, ' ').trim()]).toEqual(['2', '+6 −4']);

  sent(checkoutRow({ revision: 2 }));
  expect(bar.querySelector('[data-checkout-paths]')?.textContent?.trim()).toBe('clean');
});

test('the bar stands with no graph open, and the checkout segment is raised once one is', () => {
  const bar = draw({ at: undefined });
  expect(feed.routes.has('checkout.subscribe')).toBe(false);
  expect(bar.querySelector('[data-checkout-tenant]')).toBeNull();

  app?.place(testAim);
  flushSync();
  sent(checkoutRow({ ref: 'main' }));
  expect(bar.querySelector('[data-checkout-tenant]')).not.toBeNull();

  app?.place(undefined);
  flushSync();
  expect(bar.querySelector('[data-checkout-tenant]')).toBeNull();
});

test('a row that is not a reading keeps its figures and takes the quota’s own mark', () => {
  const bar = draw();

  sent(checkoutRow());
  expect(bar.querySelector('[data-usage-stale]')).toBeNull();

  sent(checkoutRow({ revision: 2, stale: true }));
  expect(bar.querySelector('[data-checkout-tenant]')).not.toBeNull();
  expect(bar.querySelector('[data-usage-stale]')).not.toBeNull();
});

test('the bar carries the awake warning only while the hold has failed, whatever mode was asked for', () => {
  const bar = draw();
  expect(bar.querySelector('[data-awake]')).toBeNull();

  awake.standing = { mode: 'always', state: { _tag: 'failed', reason: 'caffeinate exited 1.' }, limit: null };
  flushSync();
  expect(bar.querySelector('[data-awake]')?.getAttribute('data-awake')).toBe('failed');

  awake.standing = { mode: 'while-working', state: { _tag: 'holding' }, limit: null };
  flushSync();
  expect(bar.querySelector('[data-awake]')).toBeNull();
});

test('the standing chip names the build and the silence', () => {
  const bar = draw();
  expect(bar.querySelector('[data-standing-chip]')).not.toBeNull();
  expect(bar.querySelector('[data-standing-word]')).toBeNull();

  standing.health = {
    ok: true,
    version: '0.1.0',
    database: '/d',
    schema: { applied: 1, latest: null },
    source: { cut: null, installation: { build: '07be3311f-dirty 20260917T234650702Z', digest: 'sha256:aa' } },
    builds: { surface: { served: null }, host: { served: null } },
    standing: { build: '07be3311f-dirty 20260917T234650702Z', digest: 'sha256:aa' },
  };
  flushSync();
  expect(bar.querySelector('[data-standing-word]')?.textContent).toBe('07be331');

  standing.quietSince = NOW - 4_000;
  flushSync();
  expect(bar.querySelector('[data-standing-word]')?.textContent).toContain('not answering');
});
