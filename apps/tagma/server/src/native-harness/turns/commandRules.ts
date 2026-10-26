import { type PackedWorldStateSection, unreadable, withdrawn, worldStateSection } from '@runlith/agent/WorldState';
import { type Context, Effect, Schema } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import { CommandRule, ruleHead } from '../../executions/contract/wire/commandRules.js';
import { currentRules } from '../../executions/store/standingRules.js';

const HOW = [
  "Command rules for this thread in its home project, in order: the machine's, the home's, then this thread's own. A command in another project uses that place's project list instead.",
  'Each rule sets a wait — how long a `bash` call holds its command before it moves to the background — or a life — how long a command may run before it is killed.',
  'For each measure, in one list the last rule that matches a call decides; across the lists the lowest binds, so a lower list only shortens a higher one.',
  'The binding figure lowers a `waitMs` or `lifeMs` the call names and never raises it; a call that names none takes it instead of the default.',
  'A rule naming a program sets the life of each process of a command that matches it, counted from when the host first sees it match:',
  'when that runs out, the process and what it started are stopped and the rest of the command runs on.',
  'read_command_rules answers each rule with the words it was written from.',
].join(' ');

const ruleLines = (rules: readonly CommandRule[]): string => rules.map((rule) => `- ${ruleHead(rule)}`).join('\n');

export function commandRulesSection(
  machine: Context.Service.Shape<typeof MachineStore>,
  projectId: number,
  thread: string,
): PackedWorldStateSection {
  return worldStateSection({
    id: 'command-rules',
    codec: Schema.Array(CommandRule),
    read: () =>
      currentRules(machine, projectId, thread).pipe(
        Effect.map((standing) => (standing.length === 0 ? withdrawn : standing.map((one) => one.rule))),
        Effect.catch(() => Effect.succeed(unreadable)),
      ),
    baseline: (current) => `${HOW}\n${ruleLines(current)}`,
    update: (_previous, current) => `The command rules changed; this list replaces the previous one. ${HOW}\n${ruleLines(current)}`,
    removed: () =>
      'Commands in the home project now take the wait and life they name, or the defaults. Commands elsewhere still use their place’s project rules.',
  });
}
