import { describe, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { harnessRoot } from '../../../external-harnesses/contract/service/table.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { HarnessReports } from '../../../external-harnesses/contract/service/reports.js';
import { VendorTurns } from '../../../external-harnesses/testing/doubles.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import forkRpc from '../../../external-harnesses/testing/fixtures/codex/fork-rpc.json';
import grokStart from '../../../external-harnesses/testing/fixtures/grok/session-start.json';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { harnessSessionActive } from '../../../threads/contract/wire/harness/session.js';
import { EXECUTION_HOST_ROOT } from '../repoRoot.js';
import { whoSpeaks, type Who } from './terminalDeliveryRig.js';
import { settledOn, terminalHistoryWorld, type HistoryClaude } from './terminalHistoryRig.js';
import { OLD_MS, stamp } from './terminalRig.js';
import { windowChannel } from './windowChannel.js';

const LIBRARY = join(EXECUTION_HOST_ROOT, 'native', 'target', 'release', 'libexecution_platform.dylib');

class World extends Context.Service<World, Effect.Success<typeof terminalHistoryWorld>>()('testing/TerminalHistoryWorld') {}

type Spoken = { readonly fake: HistoryClaude; readonly who: Who; readonly runs: string[]; last: string | null };

const taken = Effect.fnUntraced(function* (spoken: Spoken, words: string, n: number, items: readonly string[]) {
  const { fake, who } = spoken;
  const prompt = `p${n}`;
  const at = { session_id: who.root, prompt_id: prompt, transcript_path: fake.transcript };
  yield* fake.record({
    type: 'user',
    uuid: `u${n}`,
    parentUuid: spoken.last,
    promptId: prompt,
    sessionId: who.root,
    message: { role: 'user', content: words },
  });
  yield* fake.cli.hook('UserPromptSubmit', at, { session: who.session, inputs: items });
  return { run: yield* settledOn(fake.cli.running()), at };
});

const typed = Effect.fnUntraced(function* (spoken: Spoken, text: string) {
  const { flow } = yield* World;
  const { fake } = spoken;
  const before = (yield* fake.events()).filter((event) => event.kind === 'enter').length;
  yield* flow.sayTo(fake.cli, text);
  const entered = yield* settledOn(
    Effect.map(fake.events(), (events) => {
      const enters = events.filter((event) => event.kind === 'enter');
      return enters.length > before ? enters.at(-1)! : null;
    }),
  );
  return [...(entered.kind === 'enter' ? entered.text : '').matchAll(/<input envelope="([^"]+)"/g)].map((found) => found[1]!);
});

const turn = Effect.fnUntraced(function* (spoken: Spoken, words: string, n: number, items: readonly string[]) {
  const { fake, who } = spoken;
  const { run, at } = yield* taken(spoken, words, n, items);
  yield* fake.record({
    type: 'assistant',
    uuid: `a${n}`,
    parentUuid: `u${n}`,
    sessionId: who.root,
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: `done ${n}` }] },
  });
  yield* fake.cli.hook('Stop', at, { session: who.session, said: { last_assistant_message: `done ${n}` } });
  yield* settledOn(Effect.map(fake.cli.running(), (running) => (running === null ? true : null)));
  spoken.runs.push(run);
  spoken.last = `a${n}`;
  return run;
});

const spoken = Effect.fnUntraced(function* (name: string, words: readonly string[]) {
  const { claude, flow } = yield* World;
  const fake = yield* claude(name);
  yield* flow.sayTo(fake.cli, words[0]!);
  const first = yield* settledOn(
    Effect.map(fake.cli.facet(), (facet) =>
      facet?.session?.state === 'running' && facet.turn !== undefined && (facet.unread ?? []).length > 0 ? facet : null,
    ),
  );
  const said: Spoken = { fake, who: whoSpeaks(first), runs: [], last: null };
  yield* turn(said, words[0]!, 1, first.unread![0]!.items);
  for (const [index, text] of words.slice(1).entries()) yield* turn(said, text, index + 2, yield* typed(said, text));
  return said;
});

const grokSpoken = Effect.fnUntraced(function* (name: string, words: readonly string[]) {
  const { vendor } = yield* World;
  const fake = yield* vendor(name, 'grok');
  yield* op('restart_thread', { threadId: fake.cli.threadId });
  yield* booted(fake, 1);
  const source = (yield* fake.cli.facet())!;
  const root = harnessRoot('grok', source.session!.argv)!;
  const session = source.session!.id;
  yield* fake.cli.hook('SessionStart', { session_id: root, source: 'startup', transcript_path: fake.transcript }, { session });
  const runs: string[] = [];
  for (const text of words) {
    yield* fake.cli.hook('UserPromptSubmit', { session_id: root, transcript_path: fake.transcript }, { session, prompt: text });
    runs.push(yield* settledOn(fake.cli.running()));
    yield* fake.cli.hook('Stop', { session_id: root }, { session, said: { lastAssistantMessage: 'done' } });
    yield* settledOn(Effect.map(fake.cli.running(), (running) => (running === null ? true : null)));
  }
  return { fake, root, runs };
});

const booted = (fake: HistoryClaude, count: number) =>
  settledOn(Effect.map(fake.boots(), (boots) => (boots.length >= count ? boots : null)));

const after = (argv: readonly string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];

const mapped = Effect.fnUntraced(function* (threadId: string) {
  const { world, flow } = yield* World;
  const units = Context.get(world.runtime.graph, MachineUnits);
  const turns = new VendorTurns(flow.db(), units);
  return yield* units.read((unit) => turns.turns(unit, threadId));
});

const died = Effect.fnUntraced(function* (threadId: string) {
  const { rig } = yield* World;
  const old = yield* stamp(-OLD_MS);
  yield* rig.store.change(threadId, (facet) =>
    Effect.succeed({
      facet: { ...facet, session: { ...facet.session!, ownerId: 'a-server-that-died', heartbeatAt: old } },
      value: undefined,
    }),
  );
});

const op = Effect.fnUntraced(function* (id: string, input: Record<string, unknown>) {
  const { world, projectId } = yield* World;
  const answer = yield* world.op(id, input, `project=${projectId}`);
  if (answer.status !== 200) return yield* Effect.die(new Error(`${id} refused: ${JSON.stringify(answer.body)}`));
  return answer.body as Record<string, unknown>;
});

describe.skipIf(!existsSync(LIBRARY))('terminal history', () => {
  layer(Layer.effect(World, terminalHistoryWorld).pipe(Layer.provideMerge(BunFileSystem.layer)), {
    excludeTestServices: true,
  })('PTY world', (it) => {
    it.effect(
      'a rewind under a standing Claude Code CLI cuts its session offline, stands the CLI on the cut root with its unsent composer text, and a restore stands it back on the root it was cut from',
      () =>
        Effect.gen(function* () {
          const { cuts } = yield* World;
          const said = yield* spoken('rewound-standing', ['first words', 'second words']);
          const { fake, who } = said;
          yield* fake.draft('unsent words');
          yield* fake.shown('❯ unsent words');
          const rewound = yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'from' });
          const boots = yield* booted(fake, 2);
          const own = Effect.map(cuts(), (asked) => asked.filter((one) => one.method === 'fork' && one.params.root === who.root));
          const fork = (yield* own)[0]!;
          expect(fork.params).toMatchObject({ address: 'a1' });
          const cut = String(fork.result.sessionId);
          expect(after(boots[1]!, '--resume')).toBe(cut);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(cut);
          const typedBack = yield* settledOn(
            Effect.map(fake.events(), (events) => {
              const pid = events.filter((event) => event.kind === 'boot').at(-1)!.pid;
              const own = events.filter((event) => event.pid === pid);
              return own.some((event) => event.kind === 'paste') ? own : null;
            }),
          );
          expect(typedBack.filter((event) => event.kind === 'paste').map((event) => (event.kind === 'paste' ? event.text : ''))).toEqual([
            'unsent words',
          ]);
          expect(typedBack.some((event) => event.kind === 'enter')).toBe(false);
          yield* fake.undraft();
          yield* op('restore_thread', { threadId: fake.cli.threadId, rewindId: rewound.rewindId });
          const restored = yield* booted(fake, 3);
          expect(after(restored[2]!, '--resume')).toBe(who.root);
          expect(yield* own).toHaveLength(1);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(who.root);
        }),
    );

    it.effect('a rewind with no CLI standing starts none, and the next words raise the CLI on the cut root', () =>
      Effect.gen(function* () {
        const { cuts, flow } = yield* World;
        const said = yield* spoken('rewound-resting', ['first words', 'second words']);
        const { fake, who } = said;
        yield* fake.cli.release();
        yield* settledOn(Effect.map(fake.cli.facet(), (facet) => (harnessSessionActive(facet?.session) ? null : true)));
        yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'from' });
        yield* flow.sayTo(fake.cli, 'third words');
        const boots = yield* booted(fake, 2);
        const fork = (yield* cuts()).filter((asked) => asked.method === 'fork' && asked.params.root === who.root)[0]!;
        expect(fork.params).toMatchObject({ address: 'a1' });
        expect(after(boots[1]!, '--resume')).toBe(String(fork.result.sessionId));
        expect(boots[1]!.join(' ')).toContain('third words');
      }),
    );

    it.effect('a fork seats each child at once on its own vendor root, whole or before a turn, and leaves the source on its root', () =>
      Effect.gen(function* () {
        const { cuts, rig } = yield* World;
        const said = yield* spoken('forked-source', ['first words', 'second words']);
        const { fake, who } = said;
        const born = (input: Record<string, unknown>) =>
          Effect.map(op('branch_thread', { threadId: fake.cli.threadId, ...input }), (answer) => String(answer.threadId));
        const children = [yield* born({}), yield* born({}), yield* born({ before: said.runs[1] })];
        yield* booted(fake, 1 + children.length);
        const forks = yield* settledOn(
          Effect.map(cuts(), (asked) => {
            const mine = asked.filter((one) => one.method === 'fork' && one.params.root === who.root);
            return mine.length >= children.length ? mine : null;
          }),
        );
        expect(forks.map((one) => one.params.address).toSorted()).toEqual(['a1', null, null].toSorted());
        expect(new Set(forks.map((one) => one.result.sessionId)).size).toBe(children.length);
        for (const child of children) {
          const facet = yield* settledOn(
            Effect.map(rig.store.read(child), (standing) => (standing?.sessionKey === null || standing === null ? null : standing)),
          );
          expect(forks.map((one) => one.result.sessionId)).toContain(facet.sessionKey);
        }
        expect((yield* fake.cli.facet())?.sessionKey).toBe(who.root);
      }),
    );

    it.effect('a fork of a thread whose turn is going cuts the vendor session before that turn, and the turn stays with the source', () =>
      Effect.gen(function* () {
        const { cuts, flow, rig } = yield* World;
        const said = yield* spoken('forked-going', ['first words', 'second words']);
        const { fake, who } = said;
        const { run: going } = yield* taken(said, 'third words', 3, yield* typed(said, 'third words'));
        const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
        const fork = yield* settledOn(
          Effect.map(cuts(), (asked) => asked.find((one) => one.method === 'fork' && one.params.root === who.root) ?? null),
        );
        expect(fork.params).toMatchObject({ address: 'a2' });
        const boots = yield* booted(fake, 2);
        expect(after(boots[1]!, '--resume')).toBe(String(fork.result.sessionId));
        expect(yield* settledOn(Effect.map(rig.store.read(child), (standing) => standing?.sessionKey ?? null))).toBe(
          String(fork.result.sessionId),
        );
        expect((yield* mapped(child)).map((row) => row.run)).toEqual(said.runs);
        const runsIn = (threadId: string) =>
          Effect.map(flow.harness().reads.snapshot(threadId), (state) => state.transcript.map((entry) => entry.runId));
        expect(yield* runsIn(fake.cli.threadId)).toContain(going);
        const carried = yield* runsIn(child);
        expect(carried).toContain(said.runs[1]);
        expect(carried).not.toContain(going);
        expect(yield* fake.cli.running()).toBe(going);
      }),
    );

    it.effect(
      'a Prepare cut its server died in the middle of is taken again from the same root by the server after it, once, and the root the dead attempt made is never stood on',
      () =>
        Effect.gen(function* () {
          const { cuts, flow, holdCuts, cutsHeld, releaseCuts } = yield* World;
          const said = yield* spoken('crash-cut', ['first words', 'second words']);
          const { fake, who } = said;
          const own = Effect.map(cuts(), (asked) => asked.filter((one) => one.method === 'fork' && one.params.root === who.root));
          yield* fake.cli.watch();
          expect(yield* own).toEqual([]);
          yield* holdCuts();
          yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'from' });
          yield* settledOn(Effect.map(cutsHeld(), (held) => (held > 0 ? true : null)));
          yield* died(fake.cli.threadId);
          yield* releaseCuts();
          const abandoned = String((yield* settledOn(Effect.map(own, (asked) => asked[0] ?? null))).result.sessionId);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(who.root);
          const ended = Effect.map(fake.cli.facet(), (facet) => (harnessSessionActive(facet?.session) ? null : true));
          yield* settledOn(Effect.andThen(fake.cli.watch(), ended));
          yield* flow.sayTo(fake.cli, 'third words');
          const boots = yield* booted(fake, 2);
          const retried = (yield* own)[1]!;
          expect(retried.params).toMatchObject({ root: who.root, address: 'a1' });
          const cut = String(retried.result.sessionId);
          expect(cut).not.toBe(abandoned);
          expect(after(boots[1]!, '--resume')).toBe(cut);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(cut);
          expect((yield* mapped(fake.cli.threadId)).map((row) => row.run)).toEqual(said.runs.slice(0, 1));
          yield* fake.cli.release();
          yield* settledOn(ended);
          yield* flow.sayTo(fake.cli, 'fourth words');
          const relaunched = yield* booted(fake, 3);
          expect(after(relaunched[2]!, '--resume')).toBe(cut);
          expect(yield* own).toHaveLength(2);
          expect(relaunched.flat()).not.toContain(abandoned);
        }).pipe(Effect.ensuring(Effect.flatMap(World, (world) => Effect.orDie(world.releaseCuts())))),
    );

    it.effect(
      'a plain whole fork gets a vendor copy where the CLI cuts its session, and a cut before a turn, asked or forced by a going turn, is refused for the side it lacks',
      () =>
        Effect.gen(function* () {
          const { world, projectId, cuts, claude, stage, rig, flow } = yield* World;
          const files = yield* FileSystem.FileSystem;
          const settings = Context.get(world.runtime.graph, Settings);
          const home = join(stage, 'plain-home');
          yield* files.makeDirectory(home, { recursive: true });
          yield* files.writeFileString(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
          const profile = (value: object) => settings.write({ scope: 'project', projectId, key: 'threads.harnessProfile', value });
          yield* profile({ 'claude-code': { home, plain: true } });
          const fake = yield* claude('plain-source').pipe(Effect.ensuring(Effect.orDie(profile({}))));
          yield* op('restart_thread', { threadId: fake.cli.threadId });
          yield* booted(fake, 1);
          const source = yield* settledOn(Effect.map(fake.cli.facet(), (facet) => (facet?.sessionKey == null ? null : facet)));
          expect(source.plain).toBe(true);
          const root = source.sessionKey!;
          const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
          const fork = yield* settledOn(
            Effect.map(cuts(), (asked) => asked.find((one) => one.method === 'fork' && one.params.root === root) ?? null),
          );
          expect(fork.params).toMatchObject({ address: null });
          const boots = yield* booted(fake, 2);
          expect(after(boots[1]!, '--resume')).toBe(String(fork.result.sessionId));
          expect((yield* rig.store.read(child))?.sessionKey).toBe(String(fork.result.sessionId));
          const refused = (input: Record<string, unknown>) =>
            Effect.map(world.op('branch_thread', { threadId: fake.cli.threadId, ...input }, `project=${projectId}`), (answer) => ({
              status: answer.status,
              body: answer.body as { readonly code?: string; readonly reason?: string },
            }));
          const asked = yield* refused({ before: 'a-run-of-the-source' });
          expect(asked.body.code).toBe('transport-cannot');
          expect(asked.body.reason).toContain('`copies.point`');
          yield* flow.sayTo(fake.cli, 'plain words');
          yield* settledOn(fake.cli.running());
          const going = yield* refused({});
          expect(going.body.code).toBe('transport-cannot');
          expect(going.body.reason).toContain('`copies.point`');
        }),
    );

    it.effect('a rewind the CLI cannot cut seats a fresh session that is told the kept turns once, naming the ones left out', () =>
      Effect.gen(function* () {
        const { world } = yield* World;
        const said = yield* spoken('rewound-seeded', ['first words', 'second words', 'third words']);
        const { fake } = said;
        yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'turn' });
        const boots = yield* booted(fake, 2);
        const fresh = after(boots[1]!, '--session-id')!;
        expect(boots[1]).not.toContain('--resume');
        const facet = (yield* fake.cli.facet())!;
        expect(facet.observation.diagnostics.map((note) => note.cause)).toContain('history-seeded');
        const receipt = yield* fake.cli.hook(
          'SessionStart',
          { session_id: fresh, source: 'startup', transcript_path: fake.transcript },
          { session: facet.session!.id },
        );
        expect(receipt.seeded).toBe(true);
        const seed = (room: number) =>
          Effect.map(
            world.op('guide_harness', { kind: 'seed', room }, '', { [GRANT_HEADER]: grantFor(fake.cli.threadId) }),
            (answer) => (answer.body as { readonly text: string | null }).text,
          );
        const told = (yield* Effect.all([seed(300), seed(300)], { concurrency: 'unbounded' })).filter((text) => text !== null);
        expect(told).toHaveLength(1);
        expect(told[0]).toContain('third words');
        expect(told[0]).toContain('The first 1 of 2 turns are left out');
        expect(yield* seed(10_000)).toBeNull();
      }),
    );

    it.effect('a restore while the cut of a rewind is still being prepared leaves the CLI on the root the journal holds again', () =>
      Effect.gen(function* () {
        const { holdCuts, cutsHeld, releaseCuts } = yield* World;
        const said = yield* spoken('restored-mid-cut', ['first words', 'second words']);
        const { fake, who } = said;
        yield* holdCuts();
        const rewound = yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'from' });
        yield* settledOn(Effect.map(cutsHeld(), (held) => (held > 0 ? true : null)));
        yield* op('restore_thread', { threadId: fake.cli.threadId, rewindId: rewound.rewindId });
        yield* releaseCuts();
        const boots = yield* booted(fake, 2);
        expect(after(boots[1]!, '--resume')).toBe(who.root);
        expect((yield* fake.cli.facet())?.sessionKey).toBe(who.root);
        expect((yield* mapped(fake.cli.threadId)).map((row) => row.run)).toEqual(said.runs);
      }).pipe(Effect.ensuring(Effect.flatMap(World, (world) => Effect.orDie(world.releaseCuts())))),
    );

    it.effect(
      'a Codex branch before a run and a later rewind take separate durable roots through app-server, with inherited turn ids and the thread cwd',
      () =>
        Effect.gen(function* () {
          const { vendor, cuts, rig } = yield* World;
          const fake = yield* vendor('codex-branch', 'codex');
          yield* op('restart_thread', { threadId: fake.cli.threadId });
          yield* booted(fake, 1);
          const source = (yield* fake.cli.facet())!;
          const root = harnessRoot('codex', source.session!.argv)!;
          const ids = forkRpc.wholeRead.thread.turns.map((turn) => turn.id).slice(0, 2);
          const runs: string[] = [];
          for (const [n, id] of ids.entries()) {
            const at = { session_id: root, turn_id: id, transcript_path: fake.transcript };
            yield* fake.cli.hook('UserPromptSubmit', at, { session: source.session!.id, prompt: `words ${n}` });
            runs.push(yield* settledOn(fake.cli.running()));
            yield* fake.record({ type: 'event_msg', payload: { type: 'task_complete', turn_id: id, last_agent_message: `done ${n}` } });
            yield* fake.cli.hook('Stop', at, { session: source.session!.id, said: { last_assistant_message: `done ${n}` } });
            yield* settledOn(Effect.map(fake.cli.running(), (running) => (running === null ? true : null)));
          }
          const before = yield* mapped(fake.cli.threadId);
          expect(before.map((row) => row.address)).toEqual(ids);
          const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId, before: runs[1] })).threadId);
          const boots = yield* booted(fake, 2);
          const fork = (yield* cuts()).find((asked) => asked.method === 'thread/fork')!;
          const forked = (yield* rig.store.read(child))!.sessionKey!;
          expect(fork.params).toEqual({ threadId: root, beforeTurnId: ids[1] });
          expect(fork.result).toMatchObject({ thread: { id: forked } });
          expect(boots[1]!.slice(-4)).toEqual(['-c', 'tui.resume_cwd=current', 'resume', forked]);
          const prefix = [{ run: runs[0]!, address: ids[0]! }];
          expect((yield* mapped(child)).map((row) => ({ run: row.run, address: row.address }))).toEqual(prefix);
          expect(yield* mapped(fake.cli.threadId)).toEqual(before);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(root);
          yield* op('rewind_thread', { threadId: fake.cli.threadId, at: runs[1], scope: 'from' });
          const rewound = yield* settledOn(
            Effect.map(fake.cli.facet(), (facet) => (facet?.sessionKey !== root ? (facet?.sessionKey ?? null) : null)),
          );
          const restarted = yield* booted(fake, 3);
          expect(new Set([root, forked, rewound]).size).toBe(3);
          expect(restarted[2]!.slice(-4)).toEqual(['-c', 'tui.resume_cwd=current', 'resume', rewound]);
          expect((yield* mapped(fake.cli.threadId)).map((row) => ({ run: row.run, address: row.address }))).toEqual(prefix);
          expect((yield* mapped(child)).map((row) => ({ run: row.run, address: row.address }))).toEqual(prefix);
          const rewinds = (yield* cuts()).filter((asked) => asked.method === 'thread/fork');
          expect(rewinds[1]!.params).toEqual({ threadId: root, beforeTurnId: ids[1] });
        }),
    );

    it.effect(
      'a Codex turn its rollout ends on the usage limit, without Stop, closes failed on the rate limit at the next turn or at the prompt, and Restart agent continues it on a new CLI',
      () =>
        Effect.gen(function* () {
          const { vendor, flow } = yield* World;
          const fake = yield* vendor('codex-limit', 'codex');
          yield* op('restart_thread', { threadId: fake.cli.threadId });
          yield* booted(fake, 1);
          const source = (yield* fake.cli.facet())!;
          const root = harnessRoot('codex', source.session!.argv)!;
          const at = (turn: string) => ({ session_id: root, turn_id: turn, transcript_path: fake.transcript });
          const limitedTurn = Effect.fnUntraced(function* (turn: string) {
            yield* fake.record({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn } });
            yield* fake.cli.hook('UserPromptSubmit', at(turn), { session: source.session!.id, prompt: `words of ${turn}` });
            const run = yield* settledOn(Effect.map(fake.cli.facet(), (facet) => (facet?.turn?.turn === turn ? facet.turn.run : null)));
            yield* fake.record({
              type: 'event_msg',
              payload: {
                type: 'task_complete',
                turn_id: turn,
                last_agent_message: null,
                error: { message: 'You’ve hit your usage limit.', codex_error_info: 'usage_limit_exceeded' },
              },
            });
            return run;
          });
          const family = (run: string) =>
            Effect.map(
              flow
                .db()
                .get<{ readonly family: string | null }>(
                  sql`select json_extract(failure, '$.reason.family') as family from thread_run where id = ${run}`,
                ),
              (row) => row?.family,
            );
          const first = yield* limitedTurn('t-first');
          const limited = yield* limitedTurn('t-limited');
          expect((yield* settledOn(flow.ended(first))).status).toBe('failed');
          expect(yield* family(first)).toBe('rate-limit');
          yield* fake.cli.quiesce();
          yield* fake.cli.watch();
          expect((yield* settledOn(flow.ended(limited))).status).toBe('failed');
          expect(yield* family(limited)).toBe('rate-limit');
          const continuing = String((yield* op('restart_thread', { threadId: fake.cli.threadId })).runId);
          const boots = yield* booted(fake, 2);
          const next = (yield* fake.cli.facet())!.session!;
          yield* fake.cli.hook('UserPromptSubmit', at('t-continued'), { session: next.id, prompt: boots[1]!.at(-1)! });
          yield* fake.record({
            type: 'event_msg',
            payload: { type: 'task_complete', turn_id: 't-continued', last_agent_message: 'Carried on.' },
          });
          yield* fake.cli.hook('Stop', at('t-continued'), { session: next.id, said: { last_assistant_message: 'Carried on.' } });
          expect((yield* settledOn(flow.ended(continuing))).status).toBe('completed');
          expect((yield* flow.runsOf(fake.cli.threadId)).at(-1)?.id).toBe(continuing);
        }),
    );

    it.effect(
      'a Grok whole fork keeps copied run rows and commits its new root only when the idle SessionStart names the assigned id',
      () =>
        Effect.gen(function* () {
          const { rig, world } = yield* World;
          const { fake, root, runs } = yield* grokSpoken('grok-fork', ['source words']);
          const before = yield* mapped(fake.cli.threadId);
          expect(before.map((row) => row.run)).toEqual(runs);
          const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
          const boots = yield* booted(fake, 2);
          const waiting = (yield* rig.store.read(child))!;
          const session = waiting.session!;
          const into = session.cut!.into;
          expect(boots[1]).toEqual(['--always-approve', '--resume', root, '--fork-session', '--session-id', into]);
          expect(waiting.sessionKey).toBeNull();
          const reports = Context.get(world.runtime.owners, HarnessReports);
          const hook = (sessionId: string) =>
            reports.reported(child, {
              session: session.id,
              event: { ...grokStart, session_id: sessionId, sessionId, transcript_path: fake.transcript },
            });
          expect((yield* hook(root)).outcome).toBe('refused');
          expect((yield* rig.store.read(child))?.sessionKey).toBeNull();
          expect((yield* hook(into)).outcome).not.toBe('refused');
          const bound = (yield* rig.store.read(child))!;
          expect(bound.sessionKey).toBe(into);
          expect(bound.session?.cut).toBeUndefined();
          expect(yield* mapped(child)).toEqual(before);
          expect(yield* mapped(fake.cli.threadId)).toEqual(before);
          expect((yield* fake.cli.facet())?.sessionKey).toBe(root);
          const events = yield* fake.events();
          const pid = events.filter((event) => event.kind === 'boot').at(-1)!.pid;
          expect(events.filter((event) => event.pid === pid && event.kind === 'enter')).toEqual([]);
        }),
    );

    it.effect(
      'a Grok fork child whose journal moves before its launch cut binds is stood again on the decision taken anew before anyone types into it, and the root that launch made is never bound',
      () =>
        Effect.gen(function* () {
          const { rig, world, flow } = yield* World;
          const { fake, root, runs } = yield* grokSpoken('grok-moved', ['first words', 'second words']);
          const child = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
          const boots = yield* booted(fake, 2);
          const waiting = (yield* rig.store.read(child))!;
          const into = waiting.session!.cut!.into;
          expect(boots[1]).toEqual(['--always-approve', '--resume', root, '--fork-session', '--session-id', into]);
          yield* settledOn(Effect.map(rig.store.read(child), (facet) => (facet?.session?.state === 'running' ? true : null)));
          yield* op('rewind_thread', { threadId: child, at: runs[1], scope: 'from' });
          const relaunched = yield* booted(fake, 3);
          expect(relaunched[2]).not.toContain('--resume');
          expect(relaunched[2]).not.toContain(into);
          const reports = Context.get(world.runtime.owners, HarnessReports);
          yield* reports.reported(child, {
            session: waiting.session!.id,
            event: { ...grokStart, session_id: into, sessionId: into, transcript_path: fake.transcript },
          });
          const standing = (yield* rig.store.read(child))!;
          expect(standing.sessionKey).not.toBe(into);
          expect(standing.session?.id).not.toBe(waiting.session!.id);
          const pid = (yield* fake.events()).filter((event) => event.kind === 'boot').at(-1)!.pid;
          yield* flow.harness().threads.handle(child, OPERATOR_PRINCIPAL).send('child words');
          const entered = yield* settledOn(
            Effect.map(
              fake.events(),
              (events) => events.find((event) => event.kind === 'enter' && event.text.includes('child words')) ?? null,
            ),
          );
          expect(entered.pid).toBe(pid);
        }),
    );

    it.effect(
      'a fork child launches under the account its source session was launched under while Tagma can still name it, and otherwise under the source row’s choice with a fresh session told the kept turns',
      () =>
        Effect.gen(function* () {
          const { cuts, rig } = yield* World;
          const said = yield* spoken('forked-account', ['first words']);
          const { fake, who } = said;
          const launchedOn = (yield* fake.cli.facet())!.session!.account!;
          const own = Effect.map(cuts(), (asked) => asked.filter((one) => one.method === 'fork' && one.params.root === who.root));
          const standing = (child: string) =>
            settledOn(Effect.map(rig.store.read(child), (facet) => (facet?.session?.state === 'running' ? facet : null)));
          const kept = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
          const boots = yield* booted(fake, 2);
          const fork = (yield* own)[0]!;
          expect(after(boots[1]!, '--resume')).toBe(String(fork.result.sessionId));
          expect((yield* standing(kept)).session?.account).toEqual(launchedOn);
          yield* fake.cli.store.change(fake.cli.threadId, (facet) =>
            Effect.succeed({
              facet: { ...facet, session: { ...facet.session!, account: { ...launchedOn, key: 'an-account-signed-out-since' } } },
              value: undefined,
            }),
          );
          const moved = String((yield* op('branch_thread', { threadId: fake.cli.threadId })).threadId);
          const reborn = yield* booted(fake, 3);
          expect(reborn[2]).not.toContain('--resume');
          const seated = yield* standing(moved);
          expect(seated.session?.account).toEqual(launchedOn);
          expect(seated.session?.seed).toBe(true);
          expect(seated.observation.diagnostics.map((note) => note.cause)).toContain('history-seeded');
          expect(yield* own).toHaveLength(1);
        }),
    );

    it.effect(
      'a stop that withdraws the turn the CLI took leaves the journal as native leaves it, and stands the CLI on its session cut before that turn',
      () =>
        Effect.gen(function* () {
          const { cuts, flow, world, projectId } = yield* World;
          const said = yield* spoken('withdrawn-standing', ['first words']);
          const { fake, who } = said;
          const { run } = yield* taken(said, 'second words', 2, yield* typed(said, 'second words'));
          yield* fake.draft('unsent words');
          yield* fake.shown('❯ unsent words');
          const window = yield* windowChannel(world);
          expect(
            yield* window['thread.stop']({ projectId, threadId: fake.cli.threadId, params: { runId: run, withdraw: true } }),
          ).toMatchObject({ status: 'stopped', runId: run });
          const state = yield* flow.harness().reads.snapshot(fake.cli.threadId);
          expect(state.transcript.filter((entry) => entry.runId === run)).toEqual([]);
          expect(state.latestRun).toMatchObject({ id: run, status: 'withdrawn' });
          expect(state.status.ending).toMatchObject({ status: 'withdrawn', words: { text: 'second words' } });
          const events = (yield* flow
            .db()
            .all<{ readonly payload: string }>(
              sql`select payload from thread_event where thread_id = ${fake.cli.threadId} order by position`,
            )).map(
            (row) =>
              JSON.parse(row.payload) as {
                readonly withdrawn?: unknown;
                readonly entry?: { readonly type?: string; readonly runId?: string };
              },
          );
          expect(events.filter((event) => event.entry?.type === 'run-end' && event.entry.runId === run)).toEqual([]);
          expect(events.filter((event) => event.withdrawn !== undefined)).toHaveLength(1);
          const fork = yield* settledOn(
            Effect.map(cuts(), (asked) => asked.find((one) => one.method === 'fork' && one.params.root === who.root) ?? null),
          );
          expect(fork.params).toMatchObject({ address: 'a1' });
          const boots = yield* booted(fake, 2);
          expect(after(boots[1]!, '--resume')).toBe(String(fork.result.sessionId));
          const pid = (yield* fake.events()).filter((event) => event.kind === 'boot').at(-1)!.pid;
          const typedBack = yield* settledOn(
            Effect.map(fake.events(), (all) => all.find((event) => event.pid === pid && event.kind === 'paste') ?? null),
          );
          expect(typedBack).toMatchObject({ text: 'unsent words' });
          yield* fake.undraft();
        }),
    );

    it.effect(
      'words sent while a CLI slow to quit is being realigned wait for the CLI the realignment stands, and none reaches the one being quit',
      () =>
        Effect.gen(function* () {
          const { flow } = yield* World;
          const said = yield* spoken('realigned-race', ['first words', 'second words']);
          const { fake } = said;
          const quitting = (yield* fake.events()).filter((event) => event.kind === 'boot').at(-1)!.pid;
          yield* fake.linger();
          yield* op('rewind_thread', { threadId: fake.cli.threadId, at: said.runs[1], scope: 'from' });
          yield* settledOn(Effect.map(fake.cli.facet(), (facet) => (facet?.session?.state === 'stopping' ? true : null)));
          yield* flow.sayTo(fake.cli, 'third words');
          yield* booted(fake, 2);
          yield* fake.unlinger();
          const standing = (yield* fake.events()).filter((event) => event.kind === 'boot').at(-1)!.pid;
          const entered = yield* settledOn(
            Effect.map(
              fake.events(),
              (events) => events.find((event) => event.kind === 'enter' && event.text.includes('third words')) ?? null,
            ),
          );
          expect(entered.pid).toBe(standing);
          expect(standing).not.toBe(quitting);
          expect(
            (yield* fake.events()).filter((event) => event.pid === quitting && event.kind !== 'boot' && event.text.includes('third words')),
          ).toEqual([]);
        }),
    );
  });
});
