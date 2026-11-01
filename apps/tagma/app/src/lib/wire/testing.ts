import { CATALOG_MODULES } from '@tagma/server/composition/catalog';
import type { WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { Layer } from '@runlith/layer/Layer';
import type { PlatformFetch } from '@runlith/layer/Platform';
import type { Point } from '@runlith/layer/Point';
import { makePoint, makeRouter } from '@runlith/layer/testing';
import { Door } from './Door.js';
import { OperationCodecs } from './operation.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';
import { WireCatalog } from './WireCatalog.js';

export const TEST_ORIGIN = 'http://localhost';

const noServer: PlatformFetch = () => Promise.reject(new Error('This test named no server.'));

export const testCatalog = (): Point<WireModule> => makePoint(WireCatalog, ...CATALOG_MODULES);

export const TestCatalog = Layer.mergeAll(WireCatalog, WireCatalog.contribute('core', ...CATALOG_MODULES));

export const testOperations = (): OperationCodecs => new OperationCodecs(testCatalog());

export const loadCatalog = (): Promise<unknown> => testOperations().load();

export function testDoor(fetch: PlatformFetch = noServer): Door {
  return new Door(fetch, new ServerOrigin(TEST_ORIGIN), makeRouter(), testOperations());
}
