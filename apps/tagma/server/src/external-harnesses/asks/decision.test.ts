import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import type { SessionThreads } from '../contract/service/sessionThreads.js';
import { harnessJudging } from './decision.js';
import { builtinHarness, shippedHarnessAdapters } from '../testing/builtin.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { museCode } from '@runlith/adapter-muse/harness';
import { declaredHarness } from '../adapter/declared.js';
import { judgedCall, type PermissionAsk } from '../protocol/asks.js';

it.effect('the vendor owns tool names from its hooks through the approval verdict', () =>
  Effect.gen(function* () {
    for (const [name, tool, input] of [
      ['claude-code', 'NotebookEdit', { notebook_path: '/repo/a.ipynb', new_source: 'print(1)' }],
      ['codex', 'apply_patch', { input: '*** Begin Patch\n*** End Patch' }],
    ] as const) {
      const call = builtinHarness(name).subjectOf({ tool_name: tool, tool_use_id: 'c', tool_input: input });
      expect(call).toMatchObject({ tool });
      expect(yield* (yield* judgingFor('review', builtinModeRegistry(), name)).verdict('t', call!, true)).toMatchObject({ _tag: 'Asks' });
    }
    const read = { id: null, tool: 'Read', subject: '/repo/a.ts' };
    expect(yield* (yield* judgingFor('review', builtinModeRegistry(), 'claude-code')).verdict('t', read, false)).toEqual({
      _tag: 'Unspoken',
    });
    expect(yield* (yield* judgingFor('review', builtinModeRegistry(), 'codex')).verdict('t', read, false)).toMatchObject({ _tag: 'Asks' });
  }),
);

it.effect('an ACP-only harness asking about a vendor fetch names it by its kind: it asks to reach the address', () =>
  Effect.gen(function* () {
    const muse = declaredHarness(museCode)!;
    const ask = {
      kind: 'permission',
      id: 1,
      params: {
        toolCall: { toolCallId: 'call_1', name: 'webfetch', kind: 'fetch', rawInput: { url: 'https://example.com' } },
        options: [],
      },
    } as unknown as PermissionAsk;
    const { call } = judgedCall(ask, undefined, false, muse.tools);
    expect((yield* judgingFor('review')).prompt(muse, call)).toBe('Muse Code asks to reach `https://example.com`');
  }),
);

const PUSH = { id: 'toolu_1', tool: 'bash', subject: 'git push origin main' };

const judgingFor = Effect.fnUntraced(function* (mode: string, modes = builtinModeRegistry(), name: HarnessName = 'claude-code') {
  const threads = { find: () => Effect.succeed({ harness: { name, presentation: { install: null } }, authority: { mode } }) };
  return harnessJudging(threads as unknown as SessionThreads, modes, yield* shippedHarnessAdapters);
});

it.effect('every declared vendor tool follows its approval in trust, review and bypass', () =>
  Effect.gen(function* () {
    for (const name of ['claude-code', 'codex'] as const) {
      for (const mode of ['trust', 'review', 'bypass']) {
        const judging = yield* judgingFor(mode, builtinModeRegistry(), name);
        for (const [tool, declaration] of Object.entries(builtinHarness(name).tools.byName)) {
          const call = { id: 'c', tool, subject: '/repo/a' };
          const asks = mode === 'review' && declaration.kind !== 'read';
          expect((yield* judging.verdict('t', call))._tag).toBe(asks ? 'Asks' : 'Unspoken');
        }
        expect((yield* judging.verdict('t', { id: 'u', tool: 'unknown_tool', subject: 'unknown' }))._tag).toBe(
          mode === 'review' ? 'Asks' : 'Unspoken',
        );
      }
    }
  }),
);

it.effect('review asks about a mutating foreign call and leaves a foreign read unspoken', () =>
  Effect.gen(function* () {
    const judging = yield* judgingFor('review');
    expect(yield* judging.verdict('t', PUSH, true)).toMatchObject({ _tag: 'Asks' });
    expect(yield* judging.verdict('t', { id: null, tool: 'read', subject: 'src/app.ts' }, false)).toEqual({ _tag: 'Unspoken' });
  }),
);

it.effect('trust and bypass leave a foreign call unspoken', () =>
  Effect.gen(function* () {
    for (const mode of ['trust', 'bypass']) expect(yield* (yield* judgingFor(mode)).verdict('t', PUSH, true)).toEqual({ _tag: 'Unspoken' });
  }),
);

it.effect("a registered mode's denial refuses a call outright", () =>
  Effect.gen(function* () {
    const modes = builtinModeRegistry();
    yield* modes.register('test', {
      id: 'plan',
      label: 'Plan',
      description: 'Proposes; changes nothing.',
      icon: 'eye',
      strictness: 1.5,
      refuses: (act) => (act.mutating ? { code: 'plan-only', reason: 'Plan changes nothing.' } : null),
    });
    expect(yield* (yield* judgingFor('plan', modes)).verdict('t', PUSH, true)).toEqual({
      _tag: 'Denies',
      ruleId: 'plan-only',
      reason: 'Plan changes nothing.',
    });
  }),
);
