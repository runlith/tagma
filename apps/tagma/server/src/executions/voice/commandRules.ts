import { toolPageText } from '@runlith/agent/tool/page';
import { type CommandRule, type CommandRuleListAnswer, type CommandRuleWritten, ruleLine } from '../contract/wire/commandRules.js';
import { refusalLines } from '@runlith/agent/tool/refusal';

type Refused = {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
};
type Answered<T> = ({ readonly status: 'ok' } & T) | Refused;

const refusedText = (answer: Refused): string => refusalLines(answer).join('\n');

const ORDER_WORDS =
  "the machine's rules, then the project's, then the thread's; in one list the last rule that matches a call decides, and across lists the lowest limit binds";

const ruleRows = (heading: string, rules: readonly CommandRule[]): string[] =>
  rules.length === 0 ? [] : [heading, ...rules.map((rule) => `  ${ruleLine(rule)}`)];

const cutOf = (shown: number, total: number): string => (total > shown ? ` (${shown} of ${total})` : '');

export const ruleWrittenText = (answer: Answered<CommandRuleWritten>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  return [
    `wrote ${ruleLine(answer.rule)}`,
    ...(answer.overridesTotal === 0
      ? ['it overrides no rule']
      : ruleRows(`it overrides${cutOf(answer.overrides.length, answer.overridesTotal)}:`, answer.overrides)),
    ...(answer.overriddenByTotal === 0
      ? ['no rule overrides it']
      : ruleRows(`it is overridden by${cutOf(answer.overriddenBy.length, answer.overriddenByTotal)}:`, answer.overriddenBy)),
  ].join('\n');
};

export const ruleRemovedText = (answer: Answered<{ readonly removed: CommandRule }>): string =>
  answer.status !== 'ok' ? refusedText(answer) : `removed ${ruleLine(answer.removed)}`;

export const rulesText = (answer: Answered<CommandRuleListAnswer>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  return toolPageText({
    rows: answer.rules.map((rule) => ({ label: ruleLine(rule) })),
    total: answer.total,
    order: ORDER_WORDS,
    next: answer.next === null ? undefined : `read_command_rules(cursor="${answer.next}")`,
    empty:
      answer.over !== null
        ? `no command rule stands over thread ${answer.over}`
        : answer.project === null
          ? 'no command rule stands over the machine'
          : `no command rule stands over project ${answer.project}`,
  });
};
