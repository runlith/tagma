import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deferred, Effect, Fiber } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import type { ThreadInterruptedInput } from '@runlith/agent/transcript/entries';
import { makeInputRecovery, type ThreadInterruptedRecord } from './inputRecovery.js';
import { toolOutputStore } from '../tools/outputStore.js';
import { makeThreadScratch, type ThreadScratch } from '../../threads/resources/scratch.js';
import { ScratchAreas } from '../../threads/contract/service/scratch.js';

const home = (): string => mkdtempSync(join(tmpdir(), 'tagma-input-recovery-'));

const torn = (received: string, toolCallId = 'call-abc12345') => ({
  stepNumber: 3,
  attempt: 0,
  cause: undefined,
  calls: [{ toolCallId, toolName: 'write', received, recovery: { content: 'content', destination: 'filePath' } }],
});

const recoveryOver = (scratch: ThreadScratch, recorded: ThreadInterruptedRecord, threadId: string) =>
  Effect.map(Effect.provideService(makeInputRecovery, ScratchAreas, scratch), (of) => of({ threadId, recorded }));

const keeping =
  (kept: ThreadInterruptedInput): ThreadInterruptedRecord =>
  () =>
    Effect.succeed(new Map([['call-abc12345', kept]]));

describe('recovering a request that stopped mid-argument', () => {
  it.effect('the draft lands in the thread scratch and never at the path the call named', () =>
    Effect.gen(function* () {
      const root = home();
      const scratch = yield* makeThreadScratch({ root: join(root, 'scratch') }).pipe(Effect.provide(BunFileSystem.layer));
      const store = toolOutputStore(join(root, 'outputs'));
      const target = join(root, 'never-written.html');
      const received = `{"filePath":${JSON.stringify(target)},"content":"<p>caf\\u00e9</p`;
      const body = 'z'.repeat(WIRE_ENTRY_MAX_BYTES + 1);
      const kept = yield* store
        .scope({ threadId: 't-1', ownerId: 'owner', runId: 'run-1' })
        .retainInterrupted({ toolCallId: 'call-abc12345', toolName: 'write', text: body, complete: false });
      const recovery = yield* recoveryOver(scratch, keeping(kept), 't-1');

      const guides = yield* recovery.interrupted(torn(received));

      expect(existsSync(target)).toBe(false);
      const scratchDir = scratch.directory('t-1');
      const written = readdirSync(scratchDir);
      expect(written).toHaveLength(1);
      expect(readFileSync(join(scratchDir, written[0] as string), 'utf8')).toBe('<p>caf\u00e9</p');

      const text = guides[0]?.text ?? '';
      expect(text).toContain(target);
      expect(text).toContain(join(scratchDir, written[0] as string));
      expect(text).toContain((kept as { location: string }).location);
      expect(readFileSync((kept as { location: string }).location, 'utf8')).toBe(body);
    }),
  );

  it.live('nothing is promised to the model until the record has landed', () =>
    Effect.gen(function* () {
      const root = home();
      const scratch = yield* makeThreadScratch({ root: join(root, 'scratch') }).pipe(Effect.provide(BunFileSystem.layer));
      const gate = yield* Deferred.make<void>();
      const asked: string[][] = [];
      const recorded: ThreadInterruptedRecord = Effect.fnUntraced(function* (ids) {
        asked.push([...ids]);
        yield* Deferred.await(gate);
        return new Map(ids.map((id) => [id, { kind: 'text', text: 'half', complete: false } as const]));
      });
      const recovery = yield* recoveryOver(scratch, recorded, 't-2');

      const running = yield* Effect.forkChild(recovery.interrupted(torn('{"filePath":"/tmp/a","content":"half')));
      yield* Effect.yieldNow;
      expect(running.pollUnsafe()).toBeUndefined();
      expect(asked).toEqual([['call-abc12345']]);
      expect(existsSync(scratch.directory('t-2'))).toBe(false);

      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(running)).toHaveLength(1);
    }),
  );

  it.effect('a host that refused the bytes is quoted, never read as a silence', () =>
    Effect.gen(function* () {
      const scratch = yield* makeThreadScratch({ root: join(home(), 'scratch') }).pipe(Effect.provide(BunFileSystem.layer));
      const refused: ThreadInterruptedInput = { kind: 'unavailable', reason: 'the disk is full', byteLength: 12, complete: false };
      const recovery = yield* recoveryOver(scratch, keeping(refused), 't-4');

      const guides = yield* recovery.interrupted(torn('{"filePath":"/tmp/a","content":"half'));

      expect(guides[0]?.text ?? '').toContain('the disk is full');
    }),
  );

  it.effect('a draft the agent already edited is never overwritten', () =>
    Effect.gen(function* () {
      const scratch = yield* makeThreadScratch({ root: join(home(), 'scratch') }).pipe(Effect.provide(BunFileSystem.layer));
      const recovery = yield* recoveryOver(scratch, keeping({ kind: 'text', text: 'x', complete: false }), 't-5');
      const directory = yield* scratch.ensure('t-5');
      writeFileSync(join(directory, 'interrupted-abc12345-a.html'), 'what the agent wrote by hand');

      yield* recovery.interrupted(torn('{"filePath":"/tmp/a.html","content":"a second tear'));

      expect(readFileSync(join(directory, 'interrupted-abc12345-a.html'), 'utf8')).toBe('what the agent wrote by hand');
      expect(readFileSync(join(directory, 'interrupted-abc12345-a-1.html'), 'utf8')).toBe('a second tear');
    }),
  );

  it.effect('a working-copy failure is a typed recovery failure after the input record landed', () =>
    Effect.gen(function* () {
      const scratch = yield* makeThreadScratch({ root: '/dev/null' }).pipe(Effect.provide(BunFileSystem.layer));
      const recovery = yield* recoveryOver(scratch, keeping({ kind: 'text', text: 'half', complete: false }), 't-7');

      expect(yield* Effect.flip(recovery.interrupted(torn('{"filePath":"/tmp/a","content":"half')))).toMatchObject({
        _tag: 'AgentHostFailed',
        port: 'recovery',
      });
    }),
  );

  it.effect('a tool that declares nothing recoverable writes no working copy, and the notice names the torn call', () =>
    Effect.gen(function* () {
      const scratch = yield* makeThreadScratch({ root: join(home(), 'scratch') }).pipe(Effect.provide(BunFileSystem.layer));
      const recovery = yield* recoveryOver(
        scratch,
        () => Effect.succeed(new Map([['call-1', { kind: 'text', text: '{"command":"rm -r', complete: false } as const]])),
        't-6',
      );

      const guides = yield* recovery.interrupted({
        stepNumber: 0,
        attempt: 0,
        cause: undefined,
        calls: [{ toolCallId: 'call-1', toolName: 'bash', received: '{"command":"rm -r' }],
      });

      expect(existsSync(scratch.directory('t-6'))).toBe(false);
      expect(guides).toHaveLength(1);
      expect(guides[0]?.text ?? '').toContain('call-1');
    }),
  );
});
