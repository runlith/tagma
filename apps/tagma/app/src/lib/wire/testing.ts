import { CATALOG_MODULES } from '@tagma/server/composition/catalog';
import type { WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { arms, feed, operation } from '@tagma/server/platform/contract/wire/operation';
import { Layer } from '@runlith/layer/Layer';
import type { PlatformFetch } from '@runlith/layer/Platform';
import type { Point } from '@runlith/layer/Point';
import { makePoint, makeRouter } from '@runlith/layer/testing';
import { Schema } from 'effect';
import { Door } from './Door.js';
import { OperationTable } from './operation.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';
import { WireCatalog } from './WireCatalog.js';

export const TEST_ORIGIN = 'http://localhost';

//! a lazy operations import still in flight when its test file ends fails in the shared module runner and stays failed for the next file
await Promise.all(CATALOG_MODULES.map((module: WireModule) => module.operations?.()));

const noServer: PlatformFetch = () => Promise.reject(new Error('This test named no server.'));

export const testCatalog = (...modules: readonly WireModule[]): Point<WireModule> => makePoint(WireCatalog, ...CATALOG_MODULES, ...modules);

export const TestCatalog = Layer.mergeAll(WireCatalog, WireCatalog.contribute('core', ...CATALOG_MODULES), OperationTable);

export const testOperations = (...modules: readonly WireModule[]): OperationTable => new OperationTable(testCatalog(...modules));

export const loadCatalog = (...modules: readonly WireModule[]): Promise<unknown> => testOperations(...modules).load();

export function testDoor(fetch: PlatformFetch = noServer, ...modules: readonly WireModule[]): Door {
  return new Door(fetch, new ServerOrigin(TEST_ORIGIN), makeRouter(), testOperations(...modules));
}

const STAMPS_FEED = feed('fixture.stamps', {
  input: Schema.Struct({}),
  event: Schema.Struct({ label: Schema.String }),
  refusals: [],
  callers: 'any',
});

const FIXTURE_OPERATIONS = {
  fixture_stamp: operation('fixture_stamp', {
    approval: { asksFrom: 'never' },
    doors: { http: true },
    tool: undefined,
    callers: 'any',
    subject: 'none',
    place: 'machine',
    graph: 'none',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    meaning: 'Read when the fixture last stamped.',
    input: Schema.Struct({}),
    answer: arms({ stamped: { at: Schema.Date } }),
    refusals: [],
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the stamp?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the stamp', done: 'Read the stamp' },
  }),
};

export const FIXTURE_MODULE = {
  id: 'fixture',
  operations: async () => ({ declarations: FIXTURE_OPERATIONS }),
  feeds: [STAMPS_FEED],
} as const satisfies WireModule;

declare module '@tagma/app/wire/operations' {
  interface Operations {
    readonly fixture_stamp: typeof FIXTURE_OPERATIONS.fixture_stamp;
  }
}

declare module '@tagma/app/wire/feeds' {
  interface Feeds {
    readonly 'fixture.stamps': typeof STAMPS_FEED;
  }
}
