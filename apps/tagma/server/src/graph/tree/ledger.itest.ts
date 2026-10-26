import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { TestClock } from 'effect/testing';
import { treeLedger } from './ledger.js';

it.effect('own deletion echoes expire on the graph clock while new echoes remain recognized', () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const ledger = yield* treeLedger(root, 1);
    ledger.wrote('removed.md');
    expect(ledger.echoes(['removed.md'])).toBe(true);
    yield* TestClock.adjust('30 seconds');
    ledger.wrote('next.md');
    expect(ledger.echoes(['removed.md', 'next.md'])).toBe(true);
    yield* TestClock.adjust(1);
    ledger.wrote('latest.md');
    expect(ledger.echoes(['removed.md'])).toBe(false);
    expect(ledger.echoes(['next.md', 'latest.md'])).toBe(true);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
