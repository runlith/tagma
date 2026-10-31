import type { Point } from '@runlith/layer/Point';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { makePoint, makeStorage } from '@runlith/layer/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { ThreadEntryKind } from '@runlith/agent/transcript/kinds';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { CommandDeclaration, SlotOwners } from './contribution.js';
import { WireEntryKinds } from '$lib/wire/WireEntryKinds.js';
import * as externalRecords from '../external/productRecords.js';
import * as worktreeRecords from '../worktrees/productRecords.js';
import { DraftShelf } from './DraftShelf.svelte.js';
import { DraftFiles } from './DraftFiles.js';
import * as nativeRecords from './productRecords.js';
import { type ProductRecord, ProductRecords } from './records.js';

export function testShelf(storage: PlatformStorage = makeStorage(), pictures: IDBFactory = new IDBFactory()): DraftShelf {
  return new DraftShelf(storage, new DraftFiles(pictures));
}

export function declaredCommand(declarations: readonly CommandDeclaration[], name: string, owners: SlotOwners): ComposerSlashCommand {
  const declaration = declarations.find((one) => one.name === name);
  if (declaration === undefined) throw new Error(`No command "${name}" is declared.`);
  return declaration.make(owners);
}

export function testRecords(): Point<ProductRecord> {
  return makePoint(ProductRecords, ...nativeRecords.productRecords, ...externalRecords.productRecords, ...worktreeRecords.productRecords);
}

export function testWireKinds(): Point<ThreadEntryKind> {
  return makePoint(WireEntryKinds, ...nativeRecords.entryKinds, ...externalRecords.entryKinds, ...worktreeRecords.entryKinds);
}
