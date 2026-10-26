import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { page, pageRows, pastKey, readCursor, type PageDirection, type PageKey, type PageQuestion } from '@runlith/paging';
import { MachineStore } from '../../platform/contract/service/store.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import {
  COMMAND_RULES,
  type CommandRule,
  reachOf,
  RULE_PAGE_CEILING,
  RULE_REACHES,
  type RuleList,
  type RulePosition,
  type RuleReach,
} from '../contract/wire/commandRules.js';
import { GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { type InputOf, type Refused, body, pair } from '../../platform/contract/service/body.js';
import { projectOfThread, removeRule, ruleById, threadOfProject, writeRule } from '../commands/ruleLedger.js';
import { type PlacedRule, currentRules } from '../store/standingRules.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { COMMAND_RULE_OPERATIONS } from '../contract/wire/operations/commandRules.js';
import { ruleRemovedText, rulesText, ruleWrittenText } from '../voice/commandRules.js';

const writerOf = (caller: Caller): string =>
  caller.actor.kind === 'thread'
    ? `thread:${caller.actor.threadId}`
    : caller.actor.kind === 'session'
      ? `${caller.actor.session.harness}:${caller.actor.session.key}`
      : 'operator';

const threadOf = (caller: Caller, named: string | undefined): string | null => named ?? threadIdOf(caller.actor);

const projectNamingThread = (): GateRefusal<'command-rule-thread'> =>
  new GateRefusal(
    'command-rule-thread',
    "the project's list binds every thread of the project, and `thread` names the list of one thread",
    ['drop `thread`', 'use `reach: "thread"` for that thread\'s list'],
  );

const machineNamingList = (): GateRefusal<'command-rule-thread'> =>
  new GateRefusal(
    'command-rule-thread',
    "the machine's list binds every thread of every project, and `project` or `thread` names a narrower list",
    ['drop `project` and `thread`', 'use `reach: "project"` or `reach: "thread"` for that list'],
  );

const noThread = (): GateRefusal<'command-rule-thread'> =>
  new GateRefusal('command-rule-thread', 'a thread list was asked for, and this caller is no thread and named none', [
    'name the thread in `thread`',
    'use `reach: "project"` for the project list',
  ]);

const projectNamed = Effect.fn('command_rules.project')(function* (named: string | undefined) {
  if (named === undefined) return (yield* yield* CurrentProject).project.id;
  return (yield* (yield* Projects).named(named)).id;
});

const listWords = Effect.fn('command_rules.listWords')(function* (projectId: number | null, thread: string | null) {
  if (projectId === null) return 'the machine: every thread of every project';
  const row = yield* (yield* Projects).byId(projectId);
  const project = `project ${row.name} (${projectId})`;
  return thread === null ? `${project}: every thread of it` : `thread ${thread} of ${project}`;
});

const listOf = (projectId: number | null, thread: string | null) =>
  Effect.map(listWords(projectId, thread), (words): RuleList => ({ projectId, thread, words }));

const listNamed = Effect.fn('command_rules.list')(function* (
  reach: RuleReach,
  input: { readonly project?: string | undefined; readonly thread?: string | undefined },
  caller: Caller,
) {
  if (reach === 'machine') {
    if (input.project !== undefined || input.thread !== undefined) return yield* machineNamingList();
    return yield* listOf(null, null);
  }
  if (reach === 'project') {
    if (input.thread !== undefined) return yield* projectNamingThread();
    return yield* listOf(yield* projectNamed(input.project), null);
  }
  const thread = threadOf(caller, input.thread);
  if (thread === null) return yield* noThread();
  const machine = yield* MachineStore;
  const projectId = input.project === undefined ? yield* projectOfThread(machine, thread) : yield* projectNamed(input.project);
  yield* threadOfProject(machine, projectId, thread);
  return yield* listOf(projectId, thread);
});

const positionOf = (
  input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>,
): Effect.Effect<RulePosition, GateRefusal<'command-rule-anchor'>> => {
  const at = input.at ?? 'end';
  if (at === 'before' || at === 'after') {
    return input.anchor === undefined
      ? Effect.fail(
          new GateRefusal('command-rule-anchor', `a place ${at} a rule names that rule, and \`anchor\` is missing`, [
            'name the rule in `anchor`',
            'write at `start` or `end` of the list instead',
          ]),
        )
      : Effect.succeed({ at, anchor: input.anchor });
  }
  return input.anchor === undefined
    ? Effect.succeed({ at })
    : Effect.fail(
        new GateRefusal('command-rule-anchor', `\`anchor\` names a rule to stand beside, and \`at: "${at}"\` stands beside none`, [
          'drop `anchor`',
          'use `at: "before"` or `at: "after"` with it',
        ]),
      );
};

const RULE_ORDER: readonly PageDirection[] = ['asc', 'asc', 'asc'];

const ruleKey = (one: PlacedRule): PageKey => [RULE_REACHES.indexOf(reachOf(one.rule)), one.position, one.rule.id];

export const COMMAND_RULE_PAIRS = {
  write_command_rule: pair(
    COMMAND_RULE_OPERATIONS.write_command_rule,
    body(COMMAND_RULE_OPERATIONS.write_command_rule, {
      prepare: Effect.fn('write_command_rule.prepare')(function* (
        input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>,
        caller: Caller,
      ): Effect.fn.Return<
        RuleList & { readonly position: RulePosition },
        Refused<typeof COMMAND_RULE_OPERATIONS.write_command_rule>,
        MachineStore | CurrentProject | Projects | ProjectIdentification
      > {
        const position = yield* positionOf(input);
        return { ...(yield* listNamed(input.reach, input, caller)), position };
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>,
        list: RuleList & { readonly position: RulePosition },
        caller: Caller,
      ) {
        const written = yield* writeRule(yield* MachineStore, {
          projectId: list.projectId,
          thread: list.thread,
          through: input.through ?? null,
          program: input.program ?? null,
          measure: input.measure,
          limitMs: input.limitMs,
          writer: writerOf(caller),
          words: input.words.replace(/\s+/g, ' ').trim(),
          position: list.position,
        });
        return { status: 'ok' as const, ...written };
      }),
      voice: said(ruleWrittenText),
    }),
  ),

  remove_command_rule: pair(
    COMMAND_RULE_OPERATIONS.remove_command_rule,
    body(COMMAND_RULE_OPERATIONS.remove_command_rule, {
      prepare: Effect.fn('remove_command_rule.prepare')(function* (input: InputOf<typeof COMMAND_RULE_OPERATIONS.remove_command_rule>) {
        const rule = yield* ruleById(yield* MachineStore, input.id);
        return { rule, list: yield* listOf(rule.project, rule.thread) };
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_RULE_OPERATIONS.remove_command_rule>,
        _prepared: { readonly rule: CommandRule; readonly list: RuleList },
      ) {
        return { status: 'ok' as const, removed: yield* removeRule(yield* MachineStore, input.id) };
      }),
      voice: said(ruleRemovedText),
    }),
  ),

  read_command_rules: pair(
    COMMAND_RULE_OPERATIONS.read_command_rules,
    body(COMMAND_RULE_OPERATIONS.read_command_rules, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_RULE_OPERATIONS.read_command_rules>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const machine = yield* MachineStore;
        const reach =
          input.reach ??
          (input.thread !== undefined || (caller.actor.kind === 'thread' && input.project === undefined) ? 'thread' : 'project');
        const list = yield* listNamed(reach, input, caller);
        const question: PageQuestion = {
          operation: 'read_command_rules',
          selection: {
            reach,
            projectId: list.projectId ?? undefined,
            thread: list.thread ?? undefined,
          },
          order: COMMAND_RULES.order,
        };
        const continued = input.cursor === undefined ? undefined : readCursor(input.cursor, question);
        if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
        const standing = yield* currentRules(machine, list.projectId, list.thread);
        const cut = page({
          rows: continued === undefined ? standing : pastKey(standing, ruleKey, RULE_ORDER, continued.at),
          asked: pageRows(input.limit, COMMAND_RULES, RULE_PAGE_CEILING),
          keyOf: ruleKey,
          question,
          total: standing.length,
        });
        return {
          status: 'ok' as const,
          reach,
          project: list.projectId,
          over: list.thread,
          rules: cut.rows.map((one) => one.rule),
          shown: cut.shown,
          total: standing.length,
          next: cut.next,
          complete: cut.complete,
        };
      }),
      voice: said(rulesText),
    }),
  ),
};
