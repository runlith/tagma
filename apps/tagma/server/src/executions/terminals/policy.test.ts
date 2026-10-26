import { expect, test } from 'bun:test';
import { Principal } from '@runlith/executions/protocol/custody';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { actorOfPrincipal, principalOf } from './principals.js';
import { type TerminalActor } from '../contract/wire/terminals.js';
import { terminalPolicy, type TerminalOperation } from './policy.js';

const PROJECT = 7;
const agent: TerminalActor = { _tag: 'Thread', threadId: ThreadId.make('thread-alpha'), projectId: PROJECT };
const operator: TerminalActor = { _tag: 'Operator' };
const foreign: TerminalActor = { _tag: 'Foreign', harness: 'claude-code', key: 'vendor-session', projectId: PROJECT };
const another = principalOf({ _tag: 'Thread', threadId: ThreadId.make('thread-beta'), projectId: PROJECT });

const verdict = (actor: TerminalActor, act: TerminalOperation, holder: Principal) =>
  terminalPolicy({ actor, standing: { projectId: PROJECT, holder }, act });

const ENDING: readonly TerminalOperation[] = [{ _tag: 'Signal' }, { _tag: 'Stop' }, { _tag: 'Transfer', to: { _tag: 'Operator' } }];

test('an agent signals, stops or moves its own execution and another holder`s alike', () => {
  for (const act of ENDING) {
    expect(verdict(agent, act, another)).toEqual({ _tag: 'Eligible' });
    expect(verdict(agent, act, principalOf(agent))).toEqual({ _tag: 'Eligible' });
  }
});

test('a destination outside the execution`s project refuses the operator too', () => {
  const elsewhere: TerminalOperation = {
    _tag: 'Transfer',
    to: { _tag: 'Thread', threadId: ThreadId.make('thread-elsewhere'), projectId: PROJECT + 1, live: true },
  };
  const refused = verdict(operator, elsewhere, principalOf(operator));
  expect(refused._tag).toBe('Refused');
  if (refused._tag !== 'Refused') return;
  expect(refused.refusal.reason).toBe('destination');
});

test('a destination thread that is not live refuses the operator too', () => {
  const dead: TerminalOperation = {
    _tag: 'Transfer',
    to: { _tag: 'Thread', threadId: ThreadId.make('thread-gone'), projectId: PROJECT, live: false },
  };
  const refused = verdict(operator, dead, principalOf(operator));
  expect(refused._tag).toBe('Refused');
  if (refused._tag !== 'Refused') return;
  expect(refused.refusal.reason).toBe('destination');
});

test('an agent or a foreign session of another project is refused', () => {
  const thread: TerminalActor = { _tag: 'Thread', threadId: ThreadId.make('thread-foreign'), projectId: PROJECT + 1 };
  const session: TerminalActor = { _tag: 'Foreign', harness: 'claude-code', key: 'vendor-session', projectId: PROJECT + 1 };
  for (const actor of [thread, session]) {
    const refused = verdict(actor, { _tag: 'Signal' }, principalOf(actor));
    expect(refused._tag).toBe('Refused');
    if (refused._tag === 'Refused') expect(refused.refusal.reason).toBe('foreign-project');
  }
});

test('a start takes the caller`s own custody, and another holder is a transfer', () => {
  const start = (holder: Principal) => terminalPolicy({ actor: agent, standing: { projectId: PROJECT }, act: { _tag: 'Start', holder } });
  expect(start(principalOf(agent))).toEqual({ _tag: 'Eligible' });
  const refused = start(another);
  expect(refused._tag).toBe('Refused');
  if (refused._tag !== 'Refused') return;
  expect(refused.refusal.reason).toBe('ineligible');
});

test('a foreign session meets the same table answer the operator does', () => {
  const everyAct = (self: Principal): readonly TerminalOperation[] => [
    ...ENDING,
    { _tag: 'Observe' },
    { _tag: 'Input' },
    { _tag: 'Transfer', to: { _tag: 'Thread', threadId: ThreadId.make('thread-beta'), projectId: PROJECT, live: true } },
    { _tag: 'Start', holder: self },
    { _tag: 'Start', holder: another },
  ];
  const holders = [another, principalOf(agent), principalOf(foreign), principalOf(operator)];
  const asOperator = everyAct(principalOf(operator));
  const asSession = everyAct(principalOf(foreign));
  let differed = 0;
  for (let act = 0; act < asSession.length; act += 1) {
    for (const holder of holders) {
      const mine = verdict(
        operator,
        asOperator[act] as TerminalOperation,
        holder === principalOf(foreign) ? principalOf(operator) : holder,
      );
      const theirs = verdict(foreign, asSession[act] as TerminalOperation, holder);
      if (mine._tag !== theirs._tag) differed += 1;
    }
  }
  expect(differed).toBe(0);
});

test('every actor spells its own principal, and reads back as itself', () => {
  const spelled = [operator, agent, foreign].map(principalOf);
  expect(new Set(spelled).size).toBe(3);
  expect(actorOfPrincipal(principalOf(foreign), PROJECT)).toEqual(foreign);
  expect(actorOfPrincipal(principalOf(agent), PROJECT)).toEqual(agent);
  expect(actorOfPrincipal(principalOf(operator), PROJECT)).toEqual(operator);
  const colons: TerminalActor = { _tag: 'Foreign', harness: 'codex', key: 'a:b:c', projectId: PROJECT };
  expect(actorOfPrincipal(principalOf(colons), PROJECT)).toEqual(colons);
  expect(actorOfPrincipal(Principal.make('foreign:claude-code'), PROJECT)).toBeNull();
  expect(actorOfPrincipal(Principal.make('foreign:claude-code:'), PROJECT)).toBeNull();
  expect(actorOfPrincipal(Principal.make('foreign::key'), PROJECT)).toBeNull();
});
