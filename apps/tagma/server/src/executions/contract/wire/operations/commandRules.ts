import { PAGE_CURSOR, pageLimit } from '@runlith/paging';
import { COMMAND_LIFE, COMMAND_WAIT } from '@runlith/agent-tools/CommandWork';
import { Schema } from 'effect';
import {
  RuleMeasure,
  COMMAND_RULES,
  CommandRule,
  CommandRuleListAnswer,
  CommandRuleWritten,
  CommandRuleProgram,
  limitWords,
  PROGRAM_FOLDER_MAX,
  PROGRAM_WORD_MAX,
  PROGRAM_WORDS_MAX,
  RULE_PAGE_CEILING,
  RULE_POSITIONS,
  RULE_REACHES,
  RULE_TOOLS,
  RULE_WORDS_MAX,
  type RuleList,
  RULES_PER_LIST,
  ruleLine,
} from '../commandRules.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { executionShapes } from './shape.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';

const { read, write } = executionShapes({ capability: 'graph' });

const ruleId = Schema.NonEmptyString.annotate({ description: 'A rule id, as the write answered it or read_command_rules lists it.' });

const reach = Schema.Literals(RULE_REACHES);

const thread = Schema.NonEmptyString.annotate({
  description: 'The thread whose list is meant, in any project. Omitted names your own thread; a caller that is no thread names one.',
});

const project = Schema.NonEmptyString.annotate({
  ...placeRole('value'),
  description: "The project whose list is meant, by name or id. Omitted: a named thread's own project, otherwise your own.",
});

const ORDER = `Command-rule ids name execution policies: write them as inline code; reserve [[…]] for graph blocks.

TWO MEASURES. A rule measures a command's wait or its life. The wait is how long a \`bash\` call holds its command, ${COMMAND_WAIT.defaultMs} ms by default and at most ${COMMAND_WAIT.ceilingMs}; when it passes, the command moves to the background and runs on. The life is how long a command may run at all, in place or in the background, ${COMMAND_LIFE.defaultMs} ms by default and at most ${COMMAND_LIFE.ceilingMs}; when it runs out, the command is killed. Only \`bash\` has a wait: \`inspection\` and \`commit-step\` calls and program rules take \`life\` alone. A terminal is bounded by neither.
THREE LISTS. A command stands under three ordered lists: the machine's, which binds every project; the project's where it runs; and the calling thread's own, kept in its home. Rules of each measure decide on their own. Inside one list the LAST rule that matches a call decides, so a later rule refines an earlier one. Across the lists the LOWEST decided figure binds: a higher list's figure is a ceiling that no lower list raises, and a lower list only shortens it. A rule only lowers a figure the caller named and never raises it; a call that names none takes the binding rule's figure in place of the default. Two rules overlap when both could match one call: their measure is the same, and their \`through\` is equal or either names none. Program rules decide the same way on their own and overlap only each other: their first words are equal, the other words of one stand in order among the other's, and one folder contains the other.`;

const writeParams = Schema.Struct({
  reach: reach.annotate({
    description: '`machine` binds every thread of every project; `project` every thread of one project; `thread` one thread alone.',
  }),
  project: Schema.optional(project),
  thread: Schema.optional(thread),
  through: Schema.optional(
    Schema.NonEmptyString.annotate({
      description: `The tool whose calls the rule bounds: ${RULE_TOOLS.join(', ')}. Omitted reaches every tool rules reach.`,
    }),
  ),
  program: Schema.optional(
    CommandRuleProgram.annotate({
      description: `The program a rule bounds wherever it runs inside a command: \`words\` (at most ${PROGRAM_WORDS_MAX}, each at most ${PROGRAM_WORD_MAX} characters), the first naming the program and the rest arguments it must be given in that order, and an optional \`folder\` relative to the project root (at most ${PROGRAM_FOLDER_MAX} characters, never absolute, never climbing out with \`..\`).`,
    }),
  ),
  measure: RuleMeasure.annotate({
    description:
      '`wait`: how long a `bash` call holds its command before it moves to the background. `life`: how long a command may run at all before it is killed.',
  }),
  limitMs: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
    description: `The wait or the life the rule sets, in milliseconds: a wait at most ${COMMAND_WAIT.ceilingMs}, a life at most ${COMMAND_LIFE.ceilingMs}.`,
  }),
  words: Schema.String.check(Schema.isPattern(/\S/u), Schema.isMaxLength(RULE_WORDS_MAX)).annotate({
    description: `The user's own words that asked for this rule, at most ${RULE_WORDS_MAX} characters.`,
  }),
  at: Schema.optional(
    Schema.Literals(RULE_POSITIONS).annotate({
      description: 'Where in its list the rule stands: `start`, `end` (the default), or `before`/`after` the rule `anchor` names.',
    }),
  ),
  anchor: Schema.optional(ruleId),
});

type WriteInput = typeof writeParams.Type;

const placeWords = (input: WriteInput): string =>
  input.at === 'before' || input.at === 'after' ? `${input.at} rule ${input.anchor ?? '?'}` : `at the ${input.at ?? 'end'} of the list`;

export const COMMAND_RULE_OPERATIONS = {
  write_command_rule: operation('write_command_rule', {
    approval: { asksFrom: 'trust', timeout: 'none' },
    ...write,
    answer: arms({ ok: CommandRuleWritten.fields }),
    meaning:
      "Write a rule setting how long an agent's command is waited on or may live — for every project on the machine, for one project, or for one thread — at a named place in that list.",
    grammar: `${ORDER}
THE LIST. \`reach: "machine"\` takes neither \`project\` nor \`thread\`. \`reach: "project"\` writes into the project \`project\` names, or your own. \`reach: "thread"\` writes into the thread \`thread\` names, or your own; a named \`project\` must be that thread's.
WHOLE-CALL RULES. A rule without \`program\` bounds whole tool calls. It reaches calls through ${RULE_TOOLS.map((tool) => `\`${tool}\``).join(', ')} alone for now; \`through\` names that tool, and omitted reaches every tool rules reach.
PROGRAM RULES. A rule with \`program\` sets the life of each process a command runs that matches it, wherever the command started it — a \`tsc\` that \`bun run check\` starts, the \`git commit\` in \`bun test && git commit\`. The first word matches the program's name, or the script or \`-m\` module an interpreter (node, bun, python, sh…) runs; each further word must be a later argument, exactly and in order. \`folder\` limits it to processes working in that folder of the project or below. A process's life is decided as a call's is — the last matching rule of each list, the lowest of those across the lists — counted from when the host first saw it match; when it runs out, that process and everything it started are stopped, and the rest of the command runs on. A process inside a matched one is bounded by both. A command on the default life is extended while a matched process still has life left. Program rules and whole-call rules never decide for each other, and they bind commands the execution host runs, never a command already running when the rule was written.
THE PLACE. \`at\` is \`start\`, \`end\` (the default), or \`before\`/\`after\` the rule \`anchor\` names in the SAME list; an anchor that is gone, or that stands in another list, is refused. Writes at the start or end land in the order they commit. There is no reorder: a rule moves by being removed and written again.
THE ORIGIN. \`words\` are the user's own words that asked for this rule, as given; they stand with the rule beside who wrote it and when, and every read answers them. A list holds at most ${RULES_PER_LIST} rules.
The answer names the new rule's id, the overlapping rules it overrides and the ones that override it: in one list the later wins, across lists the lower figure. Show the user the rule you wrote and what this answered.`,
    input: writeParams,
    refusals: [
      'command-rule-measure',
      'command-rule-program',
      'command-rule-folder',
      'command-rule-through',
      'command-rule-anchor',
      'command-rule-ceiling',
      'command-rule-thread',
      'unknown-project',
      'ambiguous-project',
      'not-found',
    ],
    confirmation: (input: WriteInput, prepared: RuleList) => ({
      summary: `Write a ${input.reach} command rule: ${input.through ?? 'any tool'}${
        input.program === undefined
          ? ''
          : `, program "${input.program.words.join(' ')}"${input.program.folder === undefined ? '' : ` in ${input.program.folder}`}`
      } → ${input.measure} ${limitWords(input.limitMs)}?`,
      facts: [
        { label: 'List', value: prepared.words },
        { label: 'Words', value: input.words },
        { label: 'Place', value: placeWords(input) },
      ],
      consequence: `From the next call on, it bounds the calls it matches of ${
        input.reach === 'machine'
          ? 'every thread of every project'
          : input.reach === 'project'
            ? 'every thread of the project'
            : 'that thread'
      }, unless a later rule of its list or a tighter rule of another list decides.`,
    }),
    confirmLabel: 'Write rule',
    presentation: { running: 'Writing a command rule', done: 'Wrote a command rule' },
    subjects: () => [],
  }),

  remove_command_rule: operation('remove_command_rule', {
    approval: { asksFrom: 'trust', timeout: 'none' },
    ...write,
    answer: arms({ ok: { removed: CommandRule } }),
    meaning: "Remove one command rule by its id, from whichever list holds it — the machine's, any project's or any thread's.",
    grammar: `${ORDER}
From the next call on, the rules left standing decide, or the default where none matches. The answer is the rule removed, words and origin included.`,
    input: Schema.Struct({ id: ruleId }),
    refusals: ['command-rule-missing', 'unknown-project', 'ambiguous-project', 'not-found'],
    confirmation: (_input: { readonly id: string }, prepared: { readonly rule: CommandRule; readonly list: RuleList }) => ({
      summary: `Remove command rule ${ruleLine(prepared.rule)}?`,
      facts: [{ label: 'List', value: prepared.list.words }],
      consequence: 'From the next call on, the rules left standing decide, or the default where none matches.',
    }),
    confirmLabel: 'Remove rule',
    presentation: { running: 'Removing a command rule', done: 'Removed a command rule' },
    subjects: () => [],
  }),

  read_command_rules: operation('read_command_rules', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: CommandRuleListAnswer.fields }),
    meaning: 'Read, in order, the command rules standing over a thread, over a project, or over the whole machine.',
    grammar: `${ORDER}
\`reach: "thread"\` — the default for a thread — reads the machine's rules, its home project's, then its own. A command in another project uses that place's project list instead; this reading still selects the named thread's home. \`reach: "project"\` reads the machine's rules then the project's, which bind every thread of it; \`reach: "machine"\` the machine's alone. \`project\` and \`thread\` name another project or thread. The page is \`limit\` rows, ${RULE_PAGE_CEILING} by default and at most, which is the three lists at their ceiling of ${RULES_PER_LIST}: a thread's whole standing answers in one page. It answers the total and the \`cursor\` that continues.`,
    input: Schema.Struct({
      reach: Schema.optional(
        reach.annotate({
          description:
            '`thread` reads every list over a thread; `project` the machine and project lists; `machine` the machine list alone.',
        }),
      ),
      project: Schema.optional(project),
      thread: Schema.optional(thread),
      limit: pageLimit(COMMAND_RULES, RULE_PAGE_CEILING),
      cursor: PAGE_CURSOR,
    }),
    refusals: ['command-rule-thread', 'unknown-project', 'ambiguous-project', 'not-found', 'bad-cursor', 'cursor-stale'],
    confirmation: () => ({
      summary: 'Read the command rules?',
      consequence: 'Reading starts nothing, ends nothing and grants nothing.',
    }),
    confirmLabel: 'Read rules',
    presentation: {
      running: 'Reading the command rules',
      done: 'Read the command rules',
      many: (count) => `Read the command rules ${count} times`,
    },
    subjects: () => [],
  }),
};

export type CommandRuleOperationId = keyof typeof COMMAND_RULE_OPERATIONS;
export const COMMAND_RULE_OPERATION_IDS = Object.keys(COMMAND_RULE_OPERATIONS) as readonly CommandRuleOperationId[];
