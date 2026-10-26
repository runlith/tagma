import { toolPageFooter } from '@runlith/agent/tool/page';
import { triggersSaid } from '../graph/contract/wire/enforcement.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { AnsweredFigure, Checker, EnforcementReading, EngineRow, OwnerRow, RefusalPlace } from './contract/wire/engines.js';
import { findingLine, generalLines, normSaid } from './contract/wire/findings.js';
import { reachSaid } from './contract/wire/enforcement.js';

type Refused = { readonly status: 'refused'; readonly code: string; readonly reason: string; readonly unblock: readonly string[] };

type Answered = ({ readonly status: 'ok' } & EnforcementReading) | Refused;

const fixSaid = (fix: string | null): string => (fix === null ? '' : `\n    fix: ${fix}`);

const checkerSaid = (checker: Checker): string => {
  switch (checker.kind) {
    case 'builtin':
      return `builtin ${checker.builtin} (${checker.concern})`;
    case 'program':
      return `own inspection ${checker.name} (${checker.concern})`;
    case 'linter':
      return `linter ${checker.tool}${checker.rule === null ? '' : ` rule ${checker.rule}`}`;
    case 'unread':
      return `cannot run: ${checker.reason}`;
  }
};

const followedLine = (row: EngineRow): string =>
  `${row.rule} followed as text (${row.delivery})${row.enabled ? '' : ', switched off'}${row.inspection === null ? '' : `, keeps key ${row.inspection}`} — ${row.title}`;

const rowLines = (row: EngineRow): string[] => (row.checker === null ? [followedLine(row)] : checkedLines(row, row.checker));

const checkedLines = (row: EngineRow, checker: Checker): string[] => [
  `${row.rule} ${row.strictness ?? 'unread'}, ${triggersSaid(row.on)} · ${row.inspection === null ? '' : `key ${row.inspection} (${row.function ?? 'unread'}) · `}${checkerSaid(checker)} — ${row.title}`,
  `  reach: ${reachSaid(row.places)}`,
  `  debt ${row.debt.count}${row.debt.was === null ? '' : ` (was ${row.debt.was.count} until ${row.debt.was.until})`} over ${row.debt.owners} owners · escaped ${row.escaped}${row.measured === null ? ' · not measured in this checkout' : ` · measured at ${row.measured.commit} in ${row.measured.ms} ms, ${row.measured.at}`}`,
  ...(row.refused === null
    ? []
    : [
        `  last refused ${row.refused.at}: ${row.refused.file}${row.refused.line === null ? '' : `:${row.refused.line}`} on ${row.refused.op}`,
      ]),
];

const figureLines = (figure: AnsweredFigure): string[] => {
  switch (figure.kind) {
    case 'thresholds':
      return [
        'thresholds:',
        ...figure.thresholds.map((one) => `  ${one.glob}: ${one.lines} ${one.metric}${one.why === undefined ? '' : ` — ${one.why}`}`),
      ];
    case 'lists':
      return figure.lists.map((list) => `${list.label}: ${list.items.join(', ') || 'none'}`);
    case 'counts':
      return [`${figure.label}: ${figure.counts.map((one) => `${one.name} ${one.count}`).join(', ')}`];
    case 'modules':
      return [
        `${figure.modules} modules, ${figure.relations} relations`,
        ...(figure.focus === null
          ? []
          : [
              `  ${figure.focus.module} imports ${figure.focus.imports.map((one) => one.to).join(', ') || 'nothing'}`,
              `  ${figure.focus.module} is imported by ${figure.focus.importedBy.map((one) => one.from).join(', ') || 'nothing'}`,
              `  ${figure.focus.module} entries: ${figure.focus.entries === null ? 'open whole' : figure.focus.entries.map((one) => one.at).join(', ') || 'open to no module'}`,
            ]),
      ];
  }
};

const ownerLines = (owners: readonly OwnerRow[]): string[] =>
  owners.length === 0
    ? []
    : [
        `owners: ${owners.map((one) => `${one.name} ${one.standing}${one.status === null ? '' : ` ${one.status}`} (${one.entries}) ${one.title}`).join('; ')}`,
      ];

type Listed<T> = { readonly rows: readonly T[]; readonly total: number; readonly next: string | null };

const listLines = <T>(
  name: string,
  rule: string | undefined,
  list: Listed<T> | undefined,
  line: (row: T) => string,
  order = 'by key',
): string[] =>
  list === undefined
    ? []
    : [
        `${name}:`,
        ...list.rows.map((row) => `  ${line(row)}`),
        `  ${toolPageFooter({ rows: list.rows.map(() => ({ label: '' })), total: list.total, order, empty: '', next: list.next === null ? undefined : `read_enforcement(${rule === undefined ? '' : `rule="${rule}", `}cursor="${list.next}")` })}`,
      ];

const reachedSaid = (row: RefusalPlace): string => row.said ?? (row.reached === null ? '' : `reached \`${row.reached}\``);

const timesSaid = (row: RefusalPlace): string =>
  row.times === 1 ? '' : row.first === row.at ? ` ×${row.times}` : ` ×${row.times} since ${row.first}`;

export const enforcementText = (answer: Answered): string => {
  if (answer.status !== 'ok') return refusalLines(answer).join('\n');
  const { rule } = answer;
  const lines: string[] = [];
  if (answer.counts !== undefined) {
    const { counts } = answer;
    lines.push(
      `${counts.rules} rules, ${counts.enforced} enforced: ${counts.gate} gate, ${counts.watch} watch, ${counts.note} note; ${counts.debt} debt entries, ${counts.escaped} escaped`,
    );
  }
  if (answer.rules !== undefined) lines.push(...listLines('rules', undefined, answer.rules, (row) => rowLines(row).join('\n  ')));
  if (answer.engine !== undefined) {
    const { engine } = answer;
    lines.push(...rowLines(engine.row), `base: ${engine.base === '' ? 'the repository root' : engine.base}`);
    for (const figure of engine.figures) lines.push(...figureLines(figure));
    lines.push(...ownerLines(engine.owners));
    if (engine.history.length > 0)
      lines.push(`debt history, newest first: ${engine.history.map((one) => `${one.count} at ${one.at}`).join(', ')}`);
    if (engine.historyEnds !== null) lines.push(`history ends: ${engine.historyEnds}`);
    lines.push(
      `revision ${engine.revision ?? 'none'}${engine.changed === null ? '' : ` · last ${engine.changed.act} at ${engine.changed.at}${engine.changed.session === null ? '' : ` by session ${engine.changed.session}`}`}`,
    );
  }
  if (answer.engine === undefined && answer.norm !== undefined) lines.push(normSaid(answer.norm));
  const { refusals, escaped } = answer;
  const fixes = [...(refusals?.rows ?? []).map((row) => row.fix), ...(escaped?.rows ?? []).map((row) => row.fix)];
  const owed = answer.debt?.rows.length ?? 0;
  const bare = fixes.filter((fix) => (fix ?? '') === '').length + owed;
  lines.push(
    ...ownerLines(answer.owners ?? []),
    ...(bare === 0 ? [] : generalLines(answer.engine?.generalFix ?? answer.norm?.generalFix, '', bare === fixes.length + owed)),
    ...listLines(
      'debt',
      rule,
      answer.debt,
      (row) =>
        `${row.fingerprint}${row.file === null ? '' : ` in ${row.file}`} → ${row.owner}${row.value === null ? '' : ` (${row.value})`}`,
    ),
    ...listLines(
      refusals === undefined ? 'refusals' : `refusals, ${refusals.times} at ${refusals.total} places`,
      rule,
      refusals,
      (row) =>
        `${row.at} ${row.op}${timesSaid(row)}: ${findingLine({ file: row.file, line: row.line ?? undefined, message: reachedSaid(row) })}${fixSaid(row.fix)}`,
      'newest place first',
    ),
    ...listLines(
      'escaped',
      rule,
      escaped,
      (row) =>
        `${findingLine({ file: row.path, line: row.line, message: row.said ?? row.fingerprint })} @ ${row.commit.slice(0, 10)}${row.changed === 'check' ? ', found there once the check changed' : ''}${row.holder === undefined ? '' : ` held by ${row.holder}`}${fixSaid(row.fix ?? null)}`,
    ),
    ...listLines(
      'units',
      rule,
      answer.units,
      (row) =>
        `${row.id}: ${row.territory} places, ${row.entries === null ? 'open whole' : `${row.entries} entries`}, imports ${row.imports}, imported by ${row.importedBy}`,
    ),
    `graph copy read: ${answer.graph ?? 'the machine graph'}`,
  );
  return lines.join('\n');
};
