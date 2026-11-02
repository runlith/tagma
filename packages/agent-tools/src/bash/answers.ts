import { join } from 'node:path';
import { Effect, type FileSystem, type Layer } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Git } from '@runlith/git/Git';
import { Tool } from '@runlith/agent/tool';
import type { ToolDisplayFact, ToolDisplayReference } from '@runlith/agent/tool/display';
import { OutputTail, type CheckoutMeasure, type ShellSettlement } from '../ShellRun';
import {
  humanMs,
  IN_BACKGROUND,
  lifeEnded,
  lifeWords,
  keptOutputLine,
  waitWords,
  type CommandAcceptance,
  type CommandLimit,
  type CommandPhase,
  type CommandRun,
  type CommandRunDeadline,
  type CommandTime,
} from '../CommandWork';
import type { CommandVerdict } from '../WorkspaceChanges';
import type { ExecutionRef, HostRequestKey, HostRequestRef } from '@runlith/executions/protocol/execution';
import { shellCommands, type ShellWord } from '../shellCommands';
import type { Params } from './tool';

const HEAD_BUDGET = 60;
const MOVES = new Set(['cd', 'pushd', 'popd']);
const SUBSTITUTION = /\$\(|`/;
const substituted = (word: ShellWord): boolean => !word.literal && SUBSTITUTION.test(word.text);

const headWords = (command: string): { readonly words: readonly string[]; readonly more: boolean } => {
  const parsed = (shellCommands(command) ?? []).filter((one) => one.words.length > 0);
  const at = Math.max(
    0,
    parsed.findIndex((one) => !MOVES.has(one.words[0]?.text ?? '')),
  );
  const chosen = parsed[at];
  const cut = chosen === undefined ? -1 : chosen.words.findIndex(substituted);
  if (chosen === undefined || cut === 0) {
    const lines = command.split('\n').filter((line) => line.trim() !== '');
    return { words: (lines[0] ?? '').trim().split(/\s+/), more: lines.length > 1 };
  }
  if (cut > 0) return { words: chosen.words.slice(0, cut).map((word) => word.text), more: true };
  const written = chosen.redirects.flatMap((one) =>
    one.target === 'descriptor' ? [] : substituted(one.target) ? [one.op, '…'] : [one.op, one.target.text],
  );
  return { words: [...chosen.words.map((word) => word.text), ...written], more: at < parsed.length - 1 };
};

const commandHead = (command: string): string => {
  const { words, more } = headWords(command);
  let head = '';
  for (const word of words.map((one) => one.replace(/\s+/g, ' ').trim()).filter((one) => one !== '')) {
    const next = head === '' ? word : `${head} ${word}`;
    if (next.length > HEAD_BUDGET) return head === '' ? `${word.slice(0, HEAD_BUDGET)}…` : `${head} …`;
    head = next;
  }
  return more ? `${head} …` : head;
};

export const commandLabel = (params: Params): string => params.description?.trim() || commandHead(params.command);

export const commandTitle = (params: Params) => ({ title: commandLabel(params), alone: params.description?.trim() ? true : undefined });

export type HandoffPhase = { readonly phase: CommandPhase | null; readonly unreadable: string | null };

export type Retained =
  | {
      readonly kind: 'admitted';
      readonly params: Params;
      readonly time: CommandTime;
      readonly acceptance: CommandAcceptance<ShellSettlement>;
      readonly phase: () => HandoffPhase;
      readonly waited: boolean;
    }
  | { readonly kind: 'unsubmitted' }
  | { readonly kind: 'uncertain'; readonly params: Params; readonly operation: HostRequestKey };

export type ShellServices = Layer.Layer<FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git>;

export type CommandIdentity = { readonly execution: ExecutionRef; readonly operation: HostRequestRef };

const commandReference = (named: CommandIdentity, standing: boolean): ToolDisplayReference => ({
  kind: 'command',
  execution: named.execution.execution,
  incarnation: named.execution.incarnation,
  operation: named.operation.operation,
  standing,
});

const addressDetails = (named: CommandIdentity): readonly ToolDisplayFact[] => [
  { label: 'execution', value: `${named.execution.execution}:${named.execution.incarnation}` },
  { label: 'operation', value: named.operation.operation },
];

const runLife = (run: CommandRun, deadline: CommandRunDeadline): CommandLimit | null =>
  deadline.state === 'armed' || deadline.state === 'unarmed'
    ? { ms: deadline.timeoutMs, origin: deadline.origin, rule: deadline.origin === 'rule' ? (run.rule ?? null) : null }
    : null;

const lifeOf = (run: CommandRun): string => {
  const life = runLife(run, run.deadline);
  return life === null ? 'its life could not be read' : lifeWords(life);
};

const lifeFacts = (run: CommandRun): readonly ToolDisplayFact[] => {
  const life = runLife(run, run.deadline);
  return life === null ? [] : [{ label: 'life', value: humanMs(life.ms) }];
};

export const runningAnswer = (params: Params, run: CommandRun, phase: string): Tool.ToolAnswer => {
  const where = `${run.execution.execution}:${run.execution.incarnation}`;
  const queued = phase === 'queued';
  const lines = [
    queued
      ? `Started ${where} in the background — accepted, its process not yet started (${lifeOf(run)}). ${IN_BACKGROUND}`
      : `Started ${where} in the background (${lifeOf(run)}). ${IN_BACKGROUND}`,
    run.inspect,
  ];
  return new Tool.ToolAnswer(
    lines.join('\n'),
    {
      form: 'command',
      verb: queued ? 'Not yet started' : 'Left running',
      ...commandTitle(params),
      command: params.command,
      details: [...lifeFacts(run), ...addressDetails(run)],
      reference: commandReference(run, true),
    },
    { completion: 'command' },
  );
};

const phaseState = (run: CommandRun, process: HandoffPhase): string =>
  process.phase === 'ended'
    ? 'its process has ended; its command observation is still finishing'
    : process.phase === 'queued'
      ? `accepted, its process has not started (${lifeOf(run)})`
      : process.phase === 'running'
        ? `its process is running (${lifeOf(run)})`
        : `its process phase could not be read${process.unreadable === null ? '' : `: ${process.unreadable}`}`;

export const strandedAnswer = (params: Params, run: CommandRun, process: HandoffPhase, reason: string): Tool.ToolAnswer => {
  const where = `${run.execution.execution}:${run.execution.incarnation}`;
  return new Tool.ToolAnswer(
    [
      `${where} could not be moved to the background (${reason}): ${phaseState(run, process)}. Its ending does not arrive as a notice, so read it before relying on it, and do not run it again.`,
      run.inspect,
    ].join('\n'),
    {
      form: 'command',
      verb: 'Not moved to the background',
      ...commandTitle(params),
      command: params.command,
      details: [{ label: 'phase', value: process.phase ?? 'unavailable' }, ...lifeFacts(run), ...addressDetails(run)],
      reference: commandReference(run, process.phase === 'running' || process.phase === 'queued'),
    },
  );
};

export const movedAnswer = (params: Params, run: CommandRun, wait: CommandLimit | null, process: HandoffPhase): Tool.ToolAnswer => {
  const where = `${run.execution.execution}:${run.execution.incarnation}`;
  const phase = process.phase;
  const state = phaseState(run, process);
  return new Tool.ToolAnswer(
    [
      `${wait === null ? `Moved ${where} to the background` : `The wait passed (${waitWords(wait)}), so ${where} moved to the background`}: ${state}. ${IN_BACKGROUND}`,
      run.inspect,
    ].join('\n'),
    {
      form: 'command',
      verb: wait === null ? 'Moved to the background' : 'Wait passed, moved to the background',
      ...commandTitle(params),
      command: params.command,
      details: [
        { label: 'phase', value: phase ?? 'unavailable' },
        ...(wait === null ? [] : [{ label: 'wait', value: humanMs(wait.ms) }]),
        ...lifeFacts(run),
        ...addressDetails(run),
      ],
      reference: commandReference(run, phase === 'running' || phase === 'queued'),
    },
  );
};

export const awayAnswer = (params: Params, run: CommandRun, phase: HandoffPhase): Tool.ToolAnswer => {
  const moved = movedAnswer(params, run, null, phase);
  return new Tool.ToolAnswer(moved.value, moved.display, { completion: 'command' });
};

export const noticedAnswer = (params: Params, run: CommandRun): Tool.ToolAnswer => {
  const where = `${run.execution.execution}:${run.execution.incarnation}`;
  return new Tool.ToolAnswer(
    [`${where} ended while this call was being moved to the background; its ending reached this thread as a notice.`, run.inspect].join(
      '\n',
    ),
    {
      form: 'command',
      verb: 'Ended, told as a notice',
      ...commandTitle(params),
      command: params.command,
      details: addressDetails(run),
      reference: commandReference(run, false),
    },
    { completion: 'command' },
  );
};

export const refusedAnswer = (params: Params, reason: string): Tool.ToolAnswer =>
  new Tool.ToolAnswer(
    { status: 'refused', reason },
    {
      form: 'command',
      ...commandTitle(params),
      command: params.command,
      facts: [{ label: 'refused', value: 'not admitted' }],
    },
  );

export type Expiry = { readonly ending: 'life ran out' | 'wait passed'; readonly words: string };

const lifeExpiry = (life: CommandLimit | null): Expiry => ({
  ending: 'life ran out',
  words: life === null ? 'Its life ran out, so it was stopped; the figure of that life could not be read here.' : lifeEnded(life),
});

export const ownerEnded = (run: CommandRun | null, result: ShellSettlement): Effect.Effect<Expiry> =>
  run === null || !result.settled.expired
    ? Effect.succeed(lifeExpiry(null))
    : Effect.map(run.standing, (deadline) => lifeExpiry(runLife(run, deadline)));

export const localEnded = (time: CommandTime): Expiry =>
  time.wait.ms < time.life.ms
    ? {
        ending: 'wait passed',
        words: `Killed when its wait passed (${waitWords(time.wait)}): this world keeps no command past its call, so it cannot move one to the background. ${
          time.wait.origin === 'rule'
            ? 'A longer `waitMs` does not raise it past the rule: run less work per command, or ask the user to change the rule.'
            : 'Run less work per command, or ask for a longer `waitMs`.'
        }`,
      }
    : { ending: 'life ran out', words: lifeEnded(time.life) };

type Verdicts = Record<CommandVerdict['verdict'], number>;

const nothingJudged = (): Verdicts => ({ attributed: 0, taken: 0, unproven: 0, overlap: 0, team: 0, unclaimed: 0 });

const inTree = (one: CheckoutMeasure): string => (one.own || one.tree === null ? '' : ` in ${one.tree}`);

const unreadOf = (result: ShellSettlement): readonly string[] =>
  result.checkouts.flatMap((one) => {
    const tree = one.own ? null : one.tree;
    return tree === null ? one.unread : one.unread.map((name) => join(tree, name));
  });

const movedLines = (result: ShellSettlement): readonly string[] => {
  const totals = nothingJudged();
  const lines: string[] = [];
  for (const one of result.checkouts) {
    if (one.moved.length === 0) continue;
    const counts = nothingJudged();
    for (const judged of one.verdicts) counts[judged.verdict] += 1;
    for (const verdict of Object.keys(counts) as CommandVerdict['verdict'][]) totals[verdict] += counts[verdict];
    const unread = one.unread.length;
    const unjudged = one.moved.length - one.verdicts.length - unread;
    lines.push(
      `${one.moved.length} file${one.moved.length === 1 ? '' : 's'} moved${inTree(one)} while this ran: ${counts.attributed} attributed to this session, ${counts.taken} to other sessions; ${counts.unproven} unproven, ${counts.overlap} overlap and ${counts.unclaimed} unclaimed observations belong to nobody; ${counts.team} met only by commands of this session's agent team; ${unread} unread; ${unjudged} without a command-record verdict.`,
    );
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    'read_changes reads this session’s retained paths and attribution reasons; these observations alone do not prove who wrote a file.',
    ...(totals.unproven === 0
      ? []
      : [
          'Unproven paths changed while only commands of this session could have written them, but no command line names them, so they are not this session’s lines.',
        ]),
    ...(totals.overlap + totals.unproven === 0
      ? []
      : ['To land retained overlap or unproven paths, name their files or a containing directory in submit_work `paths` and `whole`.']),
    ...(totals.team === 0
      ? []
      : [
          "Team paths are the team root's to land: its submit_work with `taking` of this session, or the paths named in `paths` and `whole`.",
        ]),
  ];
};

const headLine = (one: CheckoutMeasure): string | null => {
  const head = one.own || one.tree === null ? 'HEAD' : `HEAD of ${one.tree}`;
  if (one.head === null) return null;
  return 'unread' in one.head
    ? `whether ${head} moved while this ran is not known: ${one.head.unread}`
    : `${head} moved while this ran: ${one.head.from ?? 'no commit'} → ${one.head.to ?? 'no commit'}`;
};

const unmeasuredLine = (one: CheckoutMeasure): string | null =>
  one.unmeasured === null
    ? null
    : `${one.own || one.tree === null ? 'the checkout' : one.tree} was NOT measured: ${one.unmeasured}. Whatever this command changed there is recorded against nobody and cannot be landed or attributed, and running it again will not recover that. Write through the file tools for a change that has to be attributable, and repair the repository before relying on this measurement again.`;

export const measurement = (result: ShellSettlement, elsewhere: string | null, detailed = true): string => {
  const moved = movedLines(result);
  const unread = unreadOf(result);
  return [
    ...(moved.length > 0 ? [moved.join('\n')] : []),
    ...(detailed && unread.length > 0 ? [`Unread paths: ${JSON.stringify(unread)}`] : []),
    ...result.checkouts.flatMap((one) => [headLine(one)].filter((line) => line !== null)),
    ...(elsewhere === null ? [] : [`this command ran in ${elsewhere}, another repository, and that repository was not measured`]),
    ...(result.unseen === null
      ? []
      : [`the files this command printed could not be told apart, so no law of their places rides with it: ${result.unseen}`]),
    ...result.checkouts.flatMap((one) => [unmeasuredLine(one)].filter((line) => line !== null)),
  ].join('\n\n');
};

export const finishedAnswer = (
  params: Params,
  expiry: Expiry,
  elsewhere: string | null,
  result: ShellSettlement,
  named: CommandIdentity | null,
  note: string | null = null,
): Tool.ToolAnswer => {
  const { settled } = result;
  const printedTail = new OutputTail();
  printedTail.appendText(result.stdout);
  if (result.stderr) {
    if (result.stdout) printedTail.appendText('\n');
    printedTail.appendText(result.stderr);
  }
  const printed = printedTail.text();
  const isManaged = named !== null && result.inspect !== null;
  const measured = measurement(result, elsewhere, false);

  const meta: string[] = [];
  if (settled.notStarted !== null) {
    meta.push(`This command never started: ${settled.notStarted}. Nothing ran, and the tree is unchanged.`);
  }
  if (settled.expired) meta.push(expiry.words);
  if (settled.aborted !== null) meta.push(`The command was interrupted: ${settled.aborted}`);
  if (settled.stopped !== null) meta.push(`The command was ended by its execution owner — ${settled.stopped}.`);
  if (settled.signalDeath !== null) meta.push(settled.signalDeath);
  if (settled.unconfirmed !== null) meta.push(settled.unconfirmed);
  for (const disclosure of settled.disclosed) meta.push(disclosure);
  if (settled.code !== null && settled.code !== 0) meta.push(`Command exited with status ${settled.code}.`);
  if (note !== null) meta.push(note);

  const unread = unreadOf(result);
  const compose = (kept: string | null): OutputTail => {
    const tail = new OutputTail();
    if (unread.length > 0) {
      const shown = isManaged ? unread.slice(0, 1) : unread;
      tail.appendText(`Unread paths (${shown.length} of ${unread.length}): ${JSON.stringify(shown)}\n\n`);
    }
    tail.appendText(printed !== '' ? printed : (result.outputUnavailable ?? '(no output)'));
    if (measured !== '') tail.appendText(`\n\n${measured}`);
    if (isManaged && unread.length > 0) {
      tail.appendText(
        `\nRead retained unread-path details with read_output(execution="${named.execution.execution}", incarnation=${named.execution.incarnation}).`,
      );
    }
    const lines = kept === null ? meta : [kept, ...meta];
    if (lines.length > 0) tail.appendText(`\n\n<shell_metadata>\n${lines.join('\n')}\n</shell_metadata>`);
    return tail;
  };
  const whole = compose(null);
  const line = result.kept === null ? null : keptOutputLine(result.kept, !(result.cut || printedTail.dropped || whole.dropped));
  const answer = line === null ? whole : compose(line);

  const ending =
    settled.notStarted !== null
      ? 'not started'
      : settled.expired
        ? expiry.ending
        : settled.unconfirmed !== null
          ? 'unconfirmed'
          : settled.aborted !== null || settled.stopped !== null
            ? 'stopped'
            : settled.signalDeath !== null
              ? 'killed'
              : null;
  const wrong = ending !== null || (settled.code !== null && settled.code !== 0);
  return new Tool.ToolAnswer(
    answer.text(),
    {
      form: 'command',
      ...commandTitle(params),
      command: params.command,
      output: printed || undefined,
      facts:
        ending !== null || settled.code === null
          ? [{ label: 'ended', value: ending ?? 'unconfirmed' }]
          : settled.code === 0
            ? undefined
            : [{ label: 'exit', value: String(settled.code) }],
      details: [...(settled.code === 0 ? [{ label: 'exit', value: '0' }] : []), ...(named === null ? [] : addressDetails(named))],
      reference: named === null ? undefined : commandReference(named, false),
    },
    ending === 'stopped'
      ? { shown: result.shown, ending: 'cancelled' }
      : ending === 'unconfirmed'
        ? { shown: result.shown, ending: 'unknown' }
        : ending === 'not started'
          ? { shown: result.shown, refusal: { code: 'not-started', reason: 'Command not started.', words: 'Command not started' } }
          : {
              shown: result.shown,
              failure: wrong ? (ending === null ? `Command exited with status ${settled.code}.` : `Command ${ending}.`) : undefined,
            },
  );
};

export const finishedElsewhere = (
  params: Params,
  elsewhere: string | null,
  result: ShellSettlement,
  run: CommandRun,
): Effect.Effect<Tool.ToolAnswer> =>
  Effect.map(ownerEnded(run, result), (expiry) => {
    const answer = finishedAnswer(params, expiry, elsewhere, result, run);
    return new Tool.ToolAnswer(answer.value, answer.display, { ...answer.options, completion: 'command' });
  });
