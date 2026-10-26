import { describe, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { HarnessDirectories } from '../../../providers/accounts/harnessRows.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { EXECUTION_HOST_ROOT } from '../repoRoot.js';
import { whoSpeaks } from './terminalDeliveryRig.js';
import { settledOn, terminalHistoryWorld } from './terminalHistoryRig.js';

const LIBRARY = join(EXECUTION_HOST_ROOT, 'native', 'target', 'release', 'libexecution_platform.dylib');
const CLI = join(import.meta.dir, '..', '..', 'entries', 'cli.ts');

const realCuts = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const history = yield* terminalHistoryWorld;
  yield* files.writeFileString(
    join(history.stage, 'bin', WORLD_COMMAND),
    [
      '#!/bin/sh',
      `if [ "$1" = harness-run ] && [ "$3" = --cut ]; then exec ${process.execPath} ${CLI} "$@"; fi`,
      'printf "fixture\\n"',
    ].join('\n'),
    { mode: 0o755 },
  );
  const accounts = yield* Context.get(history.world.runtime.owners, HarnessDirectories).of(claudeCodeDescription.id);
  const home = accounts.find((row) => row.key === 'fixture-account')?.directory;
  if (home == null) return yield* Effect.die('the fixture Claude Code account names no store directory');
  return { ...history, home };
});

class World extends Context.Service<World, Effect.Success<typeof realCuts>>()('testing/ClaudeCutWorld') {}

type Row = {
  readonly type?: string;
  readonly uuid?: string;
  readonly message?: { readonly content?: unknown };
  readonly forkedFrom?: { readonly messageUuid: string };
};

const rowsOf = (text: string): readonly Row[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Row);

describe.skipIf(!existsSync(LIBRARY))('Claude Code cut', () => {
  layer(Layer.effect(World, realCuts).pipe(Layer.provideMerge(BunFileSystem.layer)), {
    excludeTestServices: true,
    timeout: '60 seconds',
    testTimeout: '40 seconds',
  })('PTY world with the real cut server', (it) => {
    it.effect(
      'a fork before a turn and a rewind are cut offline by the Agent SDK from the transcript in the account store, each onto its own root, leaving the source as it was',
      () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { claude, flow, world, projectId, rig, home } = yield* World;
          const op = (id: string, input: Record<string, unknown>) =>
            Effect.flatMap(world.op(id, input, `project=${projectId}`), (answer) =>
              answer.status === 200 ? Effect.succeed(answer.body as Record<string, unknown>) : Effect.die(JSON.stringify(answer.body)),
            );
          const fake = yield* claude('real-cut');
          yield* flow.sayTo(fake.cli, 'first words');
          const first = yield* settledOn(
            Effect.map(fake.cli.facet(), (facet) =>
              facet?.session?.state === 'running' && facet.turn !== undefined && (facet.unread ?? []).length > 0 ? facet : null,
            ),
          );
          const who = whoSpeaks(first);
          const place = yield* files.realPath(first.session!.cwd!);
          const project = join(home, 'projects', place.replace(/[^a-zA-Z0-9]/g, '-'));
          const transcript = join(project, `${who.root}.jsonl`);
          yield* files.makeDirectory(project, { recursive: true });
          const record = (line: Record<string, unknown>) =>
            files.writeFileString(
              transcript,
              `${JSON.stringify({ timestamp: '2026-10-25T00:00:00.000Z', sessionId: who.root, ...line })}\n`,
              {
                flag: 'a',
              },
            );
          const runs: string[] = [];
          const turn = Effect.fnUntraced(function* (n: number, words: string, items: readonly string[]) {
            const at = { session_id: who.root, prompt_id: `p${n}`, transcript_path: transcript };
            yield* record({
              type: 'user',
              uuid: `u${n}`,
              parentUuid: n === 1 ? null : `a${n - 1}`,
              promptId: `p${n}`,
              message: { role: 'user', content: words },
            });
            yield* fake.cli.hook('UserPromptSubmit', at, { session: who.session, inputs: items });
            const run = yield* settledOn(fake.cli.running());
            runs.push(run);
            yield* record({
              type: 'assistant',
              uuid: `a${n}`,
              parentUuid: `u${n}`,
              message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: `done ${n}` }] },
            });
            yield* fake.cli.hook('Stop', at, { session: who.session, said: { last_assistant_message: `done ${n}` } });
            yield* settledOn(Effect.map(fake.cli.running(), (running) => (running === null ? true : null)));
          });
          yield* turn(1, 'first words', first.unread![0]!.items);
          const typed = (yield* fake.events()).filter((event) => event.kind === 'enter').length;
          yield* flow.sayTo(fake.cli, 'second words');
          const entered = yield* settledOn(
            Effect.map(fake.events(), (events) => {
              const enters = events.filter((event) => event.kind === 'enter');
              return enters.length > typed ? enters.at(-1)! : null;
            }),
          );
          const said = entered.kind === 'enter' ? entered.text : '';
          yield* turn(
            2,
            'second words',
            [...said.matchAll(/<input envelope="([^"]+)"/g)].map((found) => found[1]!),
          );
          const source = yield* files.readFileString(transcript);

          const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId, before: runs[1] })).threadId);
          yield* flow.harness().threads.handle(child, 'operator').send('child words');
          const forked = yield* settledOn(Effect.map(rig.store.read(child), (standing) => standing?.sessionKey ?? null));
          yield* op('rewind_thread', { threadId: fake.cli.threadId, at: runs[1], scope: 'from' });
          const rewound = yield* settledOn(
            Effect.map(fake.cli.facet(), (facet) =>
              facet?.sessionKey !== undefined && facet.sessionKey !== who.root ? facet.sessionKey : null,
            ),
          );

          expect(new Set([who.root, forked, rewound]).size).toBe(3);
          for (const root of [forked, rewound]) {
            const copy = rowsOf(yield* files.readFileString(join(project, `${root}.jsonl`)));
            expect(copy.flatMap((row) => (row.forkedFrom === undefined ? [] : [row.forkedFrom.messageUuid]))).toEqual(['u1', 'a1']);
            expect(copy.filter((row) => row.type === 'user').map((row) => row.message?.content)).toEqual(['first words']);
          }
          const boots = yield* settledOn(Effect.map(fake.boots(), (all) => (all.some((argv) => argv.includes(rewound)) ? all : null)));
          expect(boots.some((argv) => argv[argv.indexOf('--resume') + 1] === forked)).toBe(true);
          expect(yield* files.readFileString(transcript)).toBe(source);
        }),
    );
  });
});
