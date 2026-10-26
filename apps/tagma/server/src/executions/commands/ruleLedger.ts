import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { Clock, type Context, Effect } from 'effect';
import { commandRule } from '../store/commandRule.js';
import { currentRules, listed, type ListOf, type PlacedRule, ruleOf, type Row } from '../store/standingRules.js';
import type { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { recordFacts } from '../../thread-record/facts.js';
import {
  type CommandRule,
  type CommandRuleProgram,
  type CommandRuleWritten,
  MEASURE_BOUNDS,
  RULE_TOOLS,
  RULES_PER_LIST,
  type RuleMeasure,
  type RulePosition,
  WAIT_TOOLS,
} from '../contract/wire/commandRules.js';
import { folderEscapes, overridesOf } from './ruleResolution.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

const commandRuleRows = writes('command-rules', [commandRule]);

type Machine = Context.Service.Shape<typeof MachineStore>;

export type RuleWrite = {
  readonly projectId: number | null;
  readonly thread: string | null;
  readonly through: string | null;
  readonly program: CommandRuleProgram | null;
  readonly measure: RuleMeasure;
  readonly limitMs: number;
  readonly writer: string;
  readonly words: string;
  readonly position: RulePosition;
};

const measureRefusal = (write: RuleWrite): GateRefusal<'command-rule-measure'> | null => {
  if (write.measure === 'wait' && write.program !== null) {
    return new GateRefusal(
      'command-rule-measure',
      'a program rule bounds the life of each process it matches, and a wait belongs to a whole call, so a program rule cannot measure `wait`',
      ['write it with `measure: "life"`', 'drop `program` to bound the wait of whole `bash` calls'],
    );
  }
  if (write.measure === 'wait' && write.through !== null && !WAIT_TOOLS.includes(write.through)) {
    return new GateRefusal(
      'command-rule-measure',
      `a call through ${write.through} is held until its work ends and never moves to the background, so it has no wait — only ${WAIT_TOOLS.join(', ')} has one`,
      ['write it with `measure: "life"`', `name ${WAIT_TOOLS.join(' or ')} as \`through\`, or omit it`],
    );
  }
  const ceiling = MEASURE_BOUNDS[write.measure].ceilingMs;
  if (write.limitMs > ceiling) {
    return new GateRefusal(
      'command-rule-measure',
      `a ${write.measure} is at most ${ceiling} ms, so a rule of ${write.limitMs} ms would never bind as written`,
      [`name at most ${ceiling} in \`limitMs\``],
    );
  }
  return null;
};

const beneath = Effect.fn('commandRules.beneath')(function* (machine: Machine, projectId: number | null) {
  const rows = yield* machine.db
    .select()
    .from(commandRule)
    .where(
      projectId === null ? isNotNull(commandRule.projectId) : and(eq(commandRule.projectId, projectId), isNotNull(commandRule.threadId)),
    )
    .orderBy(asc(commandRule.projectId), asc(commandRule.threadId), asc(commandRule.position), asc(commandRule.id));
  return rows.map(ruleOf);
});

export const projectOfThread = Effect.fn('commandRules.projectOfThread')(function* (machine: Machine, thread: string) {
  const row = yield* machine.db
    .select({ projectId: recordFacts.projectId })
    .from(recordFacts)
    .where(and(eq(recordFacts.id, thread), isNotNull(recordFacts.projectId)))
    .get();
  if (row === undefined || row.projectId === null) {
    return yield* new GateRefusal(
      'command-rule-thread',
      `no thread ${thread} stands in any project, so no rule can bind it or be read over it`,
      ['name a thread as list_threads answers it', 'write the rule with `reach: "project"` instead'],
    );
  }
  return row.projectId;
});

export const threadOfProject = Effect.fn('commandRules.threadOfProject')(function* (
  machine: Machine,
  projectId: number | null,
  thread: string,
) {
  const row =
    projectId === null
      ? undefined
      : yield* machine.db
          .select({ threadId: recordFacts.id })
          .from(recordFacts)
          .where(and(eq(recordFacts.id, thread), eq(recordFacts.projectId, projectId)))
          .get();
  if (row === undefined) {
    return yield* new GateRefusal(
      'command-rule-thread',
      `no thread ${thread} stands in ${projectId === null ? 'the machine list, which binds no thread alone' : `project ${projectId}`}, so no rule can bind it or be read over it`,
      [
        "name a thread of that project as list_threads answers it, or drop `project` to take the thread's own",
        'write the rule with `reach: "project"` instead',
      ],
    );
  }
  return row.threadId;
});

const listName = (list: ListOf): string =>
  list.thread !== null
    ? `thread ${list.thread}'s list`
    : list.projectId === null
      ? "the machine's list"
      : `project ${list.projectId}'s list`;

const indexOf = Effect.fn('commandRules.indexOf')(function* (machine: Machine, write: RuleWrite, list: readonly PlacedRule[]) {
  if (write.position.at === 'start') return 0;
  if (write.position.at === 'end') return list.length;
  const anchor = write.position.anchor;
  const at = list.findIndex((one) => one.rule.id === anchor);
  if (at >= 0) return write.position.at === 'before' ? at : at + 1;
  const elsewhere = yield* machine.db
    .select({ projectId: commandRule.projectId, thread: commandRule.threadId })
    .from(commandRule)
    .where(eq(commandRule.id, anchor))
    .get();
  return yield* new GateRefusal(
    'command-rule-anchor',
    elsewhere === undefined
      ? `no rule ${anchor} stands: it was removed, or never written`
      : `rule ${anchor} stands in ${listName(elsewhere)}, and a position names a rule of the list it writes into, ${listName(write)}`,
    ['read the list again with read_command_rules and name a rule of the same list', 'write at `start` or `end` of the list instead'],
  );
});

const mint = Effect.fn('commandRules.mint')(function* (machine: Machine) {
  for (;;) {
    const id = randomBytes(4).toString('hex');
    const taken = yield* machine.db.select({ id: commandRule.id }).from(commandRule).where(eq(commandRule.id, id)).get();
    if (taken === undefined) return id;
  }
});

export const writeRule = Effect.fn('commandRules.write')(function* (machine: Machine, write: RuleWrite) {
  const program = write.program?.words[0];
  if (program !== undefined && program.includes('/')) {
    return yield* new GateRefusal(
      'command-rule-program',
      `the program word ${program} names a path, and a program is matched by its name alone — the last part of its path, or the script an interpreter runs — so this rule would bind nothing`,
      [`name the program as it runs: \`${program.slice(program.lastIndexOf('/') + 1)}\``],
    );
  }
  const folder = write.program?.folder;
  if (folder !== undefined && folderEscapes(folder)) {
    return yield* new GateRefusal(
      'command-rule-folder',
      `the folder ${folder} is ${folder.startsWith('/') ? 'absolute' : 'climbing out of the project with `..`'}, and a program rule's folder is read below the project root of each command it could bind`,
      [
        'name the folder relative to the project root, inside it — `apps/api`, not `/…/apps/api` or `../other`',
        'omit `folder` to bind the program anywhere in the project',
      ],
    );
  }
  if (write.through !== null && !RULE_TOOLS.includes(write.through)) {
    return yield* new GateRefusal(
      'command-rule-through',
      `rules reach only calls through ${RULE_TOOLS.join(', ')} for now, so a rule through ${write.through} would stand and bound nothing`,
      [`name ${RULE_TOOLS.join(' or ')} as \`through\`, or omit it to reach every tool rules reach`],
    );
  }
  const measured = measureRefusal(write);
  if (measured !== null) return yield* measured;
  return yield* machine.transaction(commandRuleRows, () =>
    Effect.gen(function* () {
      if (write.thread !== null) yield* threadOfProject(machine, write.projectId, write.thread);
      const list = yield* listed(machine, write);
      if (list.length >= RULES_PER_LIST) {
        return yield* new GateRefusal(
          'command-rule-ceiling',
          `${listName(write)} already holds ${list.length} rules, and a list holds at most ${RULES_PER_LIST}`,
          ['remove a rule this one makes redundant with remove_command_rule, then write again'],
        );
      }
      const index = yield* indexOf(machine, write, list);
      const id = yield* mint(machine);
      const writtenAt = new Date(yield* Clock.currentTimeMillis);
      yield* machine.db.insert(commandRule).values({
        id,
        projectId: write.projectId,
        threadId: write.thread,
        position: index,
        through: write.through,
        program: write.program,
        measure: write.measure,
        limitMs: write.limitMs,
        writer: write.writer,
        writtenAt,
        words: write.words,
      });
      const moved = list.flatMap((one, at) => {
        const position = at < index ? at : at + 1;
        return one.position === position ? [] : [{ id: one.rule.id, position }];
      });
      yield* Effect.forEach(
        moved,
        (one) => machine.db.update(commandRule).set({ position: one.position }).where(eq(commandRule.id, one.id)),
        { discard: true },
      );
      const rule: CommandRule = {
        id,
        project: write.projectId,
        thread: write.thread,
        through: write.through,
        program: write.program,
        measure: write.measure,
        limitMs: write.limitMs,
        origin: { writer: write.writer, at: writtenAt.toISOString(), words: write.words },
      };
      const standing = (yield* currentRules(machine, write.projectId, write.thread)).map((one) => one.rule);
      const joined = write.thread === null ? [...standing, ...(yield* beneath(machine, write.projectId))] : standing;
      const { overrides, overriddenBy } = overridesOf(rule, joined);
      return {
        rule,
        overrides: overrides.slice(0, RULES_PER_LIST),
        overridesTotal: overrides.length,
        overriddenBy: overriddenBy.slice(0, RULES_PER_LIST),
        overriddenByTotal: overriddenBy.length,
      } satisfies CommandRuleWritten;
    }),
  );
});

export const ruleById = Effect.fn('commandRules.ruleById')(function* (machine: Machine, id: string) {
  const row = yield* machine.db.select().from(commandRule).where(eq(commandRule.id, id)).get();
  if (row === undefined) {
    return yield* new GateRefusal('command-rule-missing', `no rule ${id} stands on this machine`, [
      'read the list with read_command_rules and name a rule it answers',
    ]);
  }
  return ruleOf(row);
});

export const removeRule = Effect.fn('commandRules.remove')(function* (machine: Machine, id: string) {
  return yield* machine.transaction(commandRuleRows, () =>
    Effect.gen(function* () {
      const rule = yield* ruleById(machine, id);
      yield* machine.db.delete(commandRule).where(eq(commandRule.id, id));
      return rule;
    }),
  );
});
