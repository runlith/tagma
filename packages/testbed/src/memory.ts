import * as MemoryFileSystem from '@effect-vfs/memory/MemoryFileSystem';
import * as NodeCrypto from '@effect/platform-node-shared/NodeCrypto';
import { Effect, FileSystem, Layer } from 'effect';

export const make = MemoryFileSystem.make.pipe(Effect.provide(NodeCrypto.layer));

export const layer = Layer.effect(FileSystem.FileSystem, make);
