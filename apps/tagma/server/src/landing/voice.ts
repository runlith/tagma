import type { SubmitReceipt, Unrecorded } from './contract/wire/receipt.js';
import type { CarriedViolation, LandingUnjudged, RuleBodies, RuleCrossing, Watched } from '../enforcement/contract/wire/enforcement.js';
import { findingLines } from '../enforcement/contract/wire/findings.js';

const NAMED_MEASURED = 6;

const few = (paths: readonly string[]): string =>
  `${paths.slice(0, NAMED_MEASURED).join(', ')}${paths.length > NAMED_MEASURED ? `, +${paths.length - NAMED_MEASURED}` : ''}`;

export function submitLines(report: SubmitReceipt): string[] {
  if (report.status === 'nothing') {
    return [
      report.unmatched === undefined
        ? 'nothing to commit — this session holds nothing the branch does not already carry'
        : `nothing to commit — \`paths\` named no file this session holds: ${report.unmatched.join(', ')}`,
      ...unattributedLines(report),
      ...editedLines(report),
      ...unrecordedLines(report.unrecorded),
    ];
  }
  if (report.status === 'refused') return [`refused — nothing was committed: ${report.reason}`];
  return [
    `${report.commit.slice(0, 10)} · ${report.committed.length} path${report.committed.length === 1 ? '' : 's'}`,
    ...report.committed.map((path) => `  ${path}`),
    ...report.carried.map((one) => `  ${one.path} — carried lines of ${few(one.holders)}`),
    ...(report.tasks ?? []).map(
      (task) =>
        `carries the work of ${task.name} “${task.title}” (held by ${task.by === 'session' ? 'this session' : `${task.holder}, ${task.by === 'taking' ? 'taken' : 'carried'}${task.standing === undefined ? '' : `, ${task.standing}`}`}) — finish_block ${task.name} with ${report.commit.slice(0, 10)} if this commit completes it`,
    ),
    ...(report.unnamedTasks === undefined
      ? []
      : [`held tasks not attributed to this commit — tasks was omitted: ${report.unnamedTasks.join(', ')}`]),
    ...(report.left ?? []).map((path) => `  ${path} — lines remain uncommitted`),
    ...unattributedLines(report),
    ...(report.unsynced === undefined
      ? []
      : [
          `the shared index still holds the old content of ${report.unsynced.length} path${report.unsynced.length === 1 ? '' : 's'}; \`git reset -q ${report.commit.slice(0, 10)} -- <path>\` brings each level with the commit: ${report.unsynced.join(', ')}`,
        ]),
    ...(report.unmatched === undefined
      ? []
      : [`not in this commit — \`paths\` named no file this session holds: ${report.unmatched.join(', ')}`]),
    ...judgedLines(report),
    ...(report.formatSkipped === true ? ["made without the repository's commit steps, on the operator's word"] : []),
    ...editedLines(report),
    ...unrecordedLines(report.unrecorded),
  ];
}

const unattributedLines = (report: { readonly unattributed?: readonly string[] }): string[] => {
  const paths = report.unattributed ?? [];
  return paths.length === 0
    ? []
    : [
        `not in this commit — ${paths.length} path${paths.length === 1 ? '' : 's'} changed while this session's commands ran beside another writer, so nobody's record claims them, and they still stand changed in this checkout: ${few(paths)}; read_changes names every session whose command met each change — name one in paths and whole only if it is this session's work`,
      ];
};

const editedLines = (report: {
  readonly edited?: readonly string[];
  readonly kept?: readonly { readonly path: string; readonly why: string }[];
}): string[] => [
  ...(report.edited === undefined
    ? []
    : [
        `the commit steps or hooks rewrote ${report.edited.length} file${report.edited.length === 1 ? '' : 's'}, and their working files now carry it — read each again before editing: ${few(report.edited)}`,
      ]),
  ...(report.kept === undefined
    ? []
    : [
        `left as they stood in the working files (the commit has the rewritten form): ${report.kept.map((one) => `${one.path} (${one.why})`).join(', ')}`,
      ]),
];

const UNRECORDED_SAID: Record<Unrecorded['step'], string> = {
  receipt: 'the landing receipt could not be written, so the next boot reads this commit back from git',
  stamp: 'the change record could not stamp this commit on the lines it carried, so they still read as held',
  discharge: 'the change record could not release the lines the branch already carries, so they still read as held',
  reshape: "the hooks' edits could not be carried into the working files, which still stand as they were before the commit",
  tasks: 'the tasks this commit carries are named only in part, since what follows could not be read',
};

const unrecordedLines = (unrecorded: readonly Unrecorded[] | undefined): string[] =>
  (unrecorded ?? []).map((one) => `${UNRECORDED_SAID[one.step]}: ${one.reason}`);

function judgedLines(judged: {
  readonly watched?: readonly Watched[];
  readonly carriedViolations?: readonly CarriedViolation[];
  readonly rechecked?: readonly RuleCrossing[];
  readonly bodies?: RuleBodies;
  readonly unjudged?: readonly LandingUnjudged[];
}): string[] {
  const watched = judged.watched ?? [];
  const carried = judged.carriedViolations ?? [];
  const rechecked = judged.rechecked ?? [];
  const unjudged = judged.unjudged ?? [];
  const { bodies } = judged;
  return [
    ...(watched.length === 0 ? [] : [`watched (${watched.length}):`]),
    ...findingLines(
      watched.flatMap((one) => ('failed' in one ? [] : [one])),
      '  ',
      undefined,
      bodies,
    ),
    ...watched.flatMap((one) => ('failed' in one ? [`  ${one.rule} could not run: ${one.failed}`] : [])),
    ...(carried.length === 0 ? [] : [`carried violations (${carried.length}) — new crossings on what live peers hold uncommitted:`]),
    ...findingLines(
      carried,
      '  ',
      (one) =>
        `held by ${few(one.holders)}${one.withheld === undefined ? '' : `, standing only on ${one.withheld}, which this commit lacks`}`,
      bodies,
    ),
    ...(rechecked.length === 0
      ? []
      : [
          `changed inspection descriptions (${rechecked.length}) — violations outside debt across their whole reach; remeasurement records standing findings as escapes, with this commit as origin where its description introduced them:`,
        ]),
    ...findingLines(rechecked, '  ', undefined, bodies),
    ...(unjudged.length === 0 ? [] : [`unjudged (${unjudged.length}):`]),
    ...unjudged.map((one) =>
      'gate' in one ? `  the gate did not judge: ${one.cause}` : `  ${one.rule} ${one.file}:${one.line}  ${one.specifier}`,
    ),
  ];
}
