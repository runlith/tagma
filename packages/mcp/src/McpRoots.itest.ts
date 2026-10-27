import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { join, resolve } from 'node:path';
import { McpPool } from './McpPool';
import type { McpServerDeclaration } from './McpServerDeclaration';
import type { McpSdkCallResult } from './sdk';

const peer = (name: string, ...flags: string[]): McpServerDeclaration => ({
  name,
  transport: 'stdio',
  command: process.execPath,
  args: [resolve(import.meta.dir, '../test/mcpRootsServer.ts'), ...flags],
  enabled: true,
  capabilities: { kinds: ['write'], mutates: true },
  timeoutMs: 5000,
});

const said = (result: McpSdkCallResult): string =>
  'content' in result ? result.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : '';

it.live('a server that caches its roots takes the pool’s places from its first call, and a place a call brings before that call', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'mcp-roots-' });
    const checkout = join(home, 'checkout');
    const scratch = join(home, 'scratch');
    const worktree = join(home, 'worktree');
    for (const directory of [checkout, scratch, worktree]) yield* files.makeDirectory(directory);
    const pool = yield* McpPool.make();
    yield* pool.place([checkout, scratch]);
    yield* pool.reconcile([peer('cached'), peer('asking', '--on-demand')]);
    yield* pool.awaitHandshakes();
    for (const server of ['cached', 'asking']) {
      const save = (path: string, roots: readonly string[] = []) => Effect.map(pool.call(server, 'save', { path }, { roots }), said);
      expect(yield* save(join(scratch, `${server}-first.png`))).toBe('saved');
      expect(yield* save(join(checkout, `${server}-next.txt`))).toBe('saved');
      expect(yield* save(join(worktree, `${server}.txt`), [worktree])).toBe('saved');
      expect(yield* save(join(home, `${server}-outside.txt`))).toBe('outside-roots');
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
