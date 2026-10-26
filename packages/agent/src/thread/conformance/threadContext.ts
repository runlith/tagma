import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { EARLIER, compactionsOf, hold, opened, opensOnHead, quiet, started, transcriptOf } from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
const FOLDED = `## State\n${'Two files were read for the parser work, and a peer asked for care with its grammar. '.repeat(24).trim()}`;
const FIRST_FILE = 'a'.repeat(140_000);
const SECOND_FILE = 'b'.repeat(140_000);
const PEER = `<message from="peer">Mind the grammar: ${'g'.repeat(120_000)}</message>`;
export function describeThreadContext<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: what a thread's model is sent is the thread's own history`, () => {
    test(
      'a fold a run takes mid-run stands in the thread’s history, though a peer’s words and runtime guidance rode a step it covers, and the next run opens on it',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { billed: true });
        const { storage, world, threadId, handle } = stack;
        world.answers.push({ text: EARLIER });
        yield* started(stack.handle, 'What stands so far?');
        yield* quiet(world, threadId);
        const tool = hold();
        world.tool = tool;
        world.outputs.push(FIRST_FILE, SECOND_FILE);
        world.summaries.push({ summary: FOLDED });
        world.answers.push({ tool: 'work' }, { tool: 'work' }, { text: 'Both files are read.' });
        const runId = yield* started(stack.handle, 'Read both files.');
        yield* tool.reached;
        yield* handle.sendSignal({ type: 'message', addressee: 'transport', text: PEER });
        world.guides.push('Notes over the file just read.');
        tool.release();
        yield* quiet(world, threadId);
        expect(compactionsOf(yield* transcriptOf(storage, threadId)).map((entry) => [entry.runId, entry.mode, entry.status])).toEqual([
          [runId, 'automatic', 'completed'],
        ]);
        const folded = world.requests.find((request) => opensOnHead(request, FOLDED));
        if (folded === undefined) return yield* Effect.die('No request opened on the fold.');
        expect(JSON.stringify(folded)).not.toContain(PEER);
        const history = (yield* storage.aggregate.historyOf(threadId)) ?? [];
        expect(JSON.stringify(history.slice(0, folded.length))).toBe(JSON.stringify(folded));
        world.answers.push({ text: 'Going on.' });
        yield* started(stack.handle, 'Go on.');
        yield* quiet(world, threadId);
        const next = world.requests.at(-1);
        expect(opensOnHead(next, FOLDED)).toBe(true);
        expect(JSON.stringify(next)).not.toContain(FIRST_FILE);
      }),
    );
    test(
      'a history grown over the budget while idle, with nothing measured for the model it goes to, is folded before its first request leaves',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        world.answers.push({ text: EARLIER });
        yield* started(stack.handle, 'What stands so far?');
        yield* quiet(world, threadId);
        const reports = ['a', 'b', 'c', 'd'].map((letter) => `<report>${letter.repeat(96_000)}</report>`);
        for (const text of reports) yield* handle.sendSignal({ type: 'report', addressee: 'transport', text }, { ifIdle: 'persist' });
        const before = world.requests.length;
        world.summaries.push({ summary: FOLDED });
        world.answers.push({ text: 'Going on.' });
        const runId = yield* started(stack.handle, 'Go on.');
        yield* quiet(world, threadId);
        expect(world.requests).toHaveLength(before + 1);
        const first = world.requests.at(-1);
        expect(opensOnHead(first, FOLDED)).toBe(true);
        expect(JSON.stringify(first)).not.toContain(reports[0]);
        expect(compactionsOf(yield* transcriptOf(storage, threadId))).toMatchObject([
          { runId, mode: 'automatic', status: 'completed', receipt: { cause: 'projected' } },
        ]);
      }),
    );
  });
}
