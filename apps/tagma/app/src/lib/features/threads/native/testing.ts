import type { PlatformStorage } from '@runlith/layer/Platform';
import { makeStorage } from '@runlith/layer/testing';
import { IDBFactory } from 'fake-indexeddb';
import { DraftShelf } from './DraftShelf.svelte.js';
import { DraftFiles } from './DraftFiles.js';

export function testShelf(storage: PlatformStorage = makeStorage(), pictures: IDBFactory = new IDBFactory()): DraftShelf {
  return new DraftShelf(storage, new DraftFiles(pictures));
}
