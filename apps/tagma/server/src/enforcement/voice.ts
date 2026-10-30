import type { MapModule } from '@tagma/inspection/rule';
import { toolPageFooter, toolPageText } from '@runlith/agent/tool/page';
import {
  type CheckAnswer,
  type CheckedViolation,
  type EnforcedAnswer,
  type EnforcementPlan,
  type FormRow,
  type InspectionForm,
  type InspectionsReading,
  type KeyReading,
  type LandingUnjudged,
  reachSaid,
} from './contract/wire/enforcement.js';
import { findingLines } from './contract/wire/findings.js';
import { triggersSaid } from '../graph/contract/wire/enforcement.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { provenanceLine } from '../platform/contract/wire/provenance.js';
import type { ModulesSet } from './contract/wire/modules.js';
import { crowdedLine } from '../graph/voice/lines.js';

type Refused = {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
};
type Answered<T> = ({ readonly status: 'ok' } & T) | Refused;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const unjudgedLines = (unjudged: readonly LandingUnjudged[] | EnforcementPlan['unjudged']): string[] =>
  unjudged.length === 0
    ? []
    : [
        `unjudged (${unjudged.length}):`,
        ...unjudged.map((one) =>
          'gate' in one ? `  ${one.cause}` : `  ${'rule' in one ? `${one.rule} ` : ''}${one.file}:${one.line} ${one.specifier}`,
        ),
      ];

const entrySaid = (entry: NonNullable<MapModule['entries']>[number]): string =>
  `${entry.at}${entry.for === undefined ? '' : ` for [${entry.for.join(', ')}]`}${entry.role === undefined ? '' : ` as ${entry.role}`}`;

const mapLines = (map: InspectionsReading['map']): string[] => {
  if (map === undefined) return [];
  return [
    `module map assembled from the module cards (${map.modules.length} modules, ${map.relations.length} relations, region ${map.region.join(', ') || 'none'}):`,
    ...map.modules.map(
      (one) =>
        `  ${one.id}: ${one.territory.join(', ')}${one.entries === undefined ? '' : ` · entries ${one.entries.map(entrySaid).join('; ')}`}${one.order === undefined ? '' : ` · order ${one.order.map((floor) => floor.join(' ')).join(' / ')}`}`,
    ),
    ...map.relations.map((one) => `  ${one.from} -> ${one.to}${one.role === undefined ? '' : ` (${one.role})`}`),
    ...map.problems.map((one) => `  problem: ${one}`),
  ];
};

export const enforcedText = (answer: Answered<EnforcedAnswer>): string => {
  if (answer.status !== 'ok') return refusalLines(answer).join('\n');
  const copy = `graph copy: ${answer.graph ?? 'the machine graph'}`;
  const warned = answer.warning === undefined ? [] : [`warning: ${answer.warning}`];
  if (answer.strictness === 'off') {
    if (answer.was === null) return [`${answer.rule} carried no enforcement; nothing was written`, copy, ...warned].join('\n');
    return [
      answer.was === 'unreadable'
        ? `removed the enforcement document of ${answer.rule}, which did not decode; the journal keeps it`
        : `removed the enforcement of ${answer.rule}, which stood at ${answer.was.strictness}, ${triggersSaid(answer.was.on)}; the journal keeps the document`,
      copy,
      'revision: none',
      ...warned,
    ].join('\n');
  }
  return [
    `${answer.rule} is enforced at ${answer.strictness}, ${triggersSaid(answer.on ?? [])}, measured over the reach at ${answer.head} in ${seconds(answer.ms ?? 0)}`,
    copy,
    `revision: ${answer.revision ?? 'none'}`,
    ...(answer.inspection === null ? [] : [`inspection: ${answer.inspection}`]),
    `reach: ${reachSaid(answer.places)}`,
    `debt: ${answer.debt.before} → ${answer.debt.after}`,
    ...(answer.absorbed.length === 0 ? [] : [`absorbed: ${answer.absorbed.map((entry) => entry.fingerprint).join(', ')}`]),
    ...(answer.retired.length === 0 ? [] : [`retired: ${answer.retired.join(', ')}`]),
    ...(answer.escaped === 0 ? [] : [`escaped: ${answer.escaped}`]),
    ...unjudgedLines(answer.unjudged),
    ...warned,
  ].join('\n');
};

const formRowSaid = (row: FormRow): string =>
  `${row.name} — ${row.summary}${row.concern === null ? '' : ` · ${row.concern}`} · ${row.door}`;

const formLines = (form: InspectionForm): string[] => [
  `${form.name}${form.builtin === null || form.builtin === form.name ? '' : ` describes builtin ${form.builtin}`}${form.door === null ? '' : ` · ${form.door}`}${form.concern === null ? '' : ` · ${form.concern}`}${form.reach === null ? '' : ` · reach ${form.reach}`}${form.languages.length === 0 ? '' : ` · ${form.languages.join(', ')}`}`,
  form.summary,
  `fingerprint unit: ${form.unit}`,
  form.name === form.builtin ? `params of { builtin: '${form.builtin}', params }: ${form.signature}` : `call: ${form.signature}`,
  ...form.unblock.map((way) => `a refusal offers: ${way}`),
  ...(form.limitations ?? []).map((limit) => `limitation: ${limit}`),
];

const keyLines = (key: KeyReading): string[] => [
  `key ${key.key} resolves at HEAD to ${key.description}`,
  key.rules.length === 0
    ? 'no rule names it'
    : `rules naming it: ${key.rules.map((one) => `${one.rule} (${one.enabled ? (one.strictness ?? 'unread') : 'switched off'}) ${one.title}`).join('; ')}`,
];

export const inspectionsText = (answer: Answered<InspectionsReading>): string => {
  if (answer.status !== 'ok') return refusalLines(answer).join('\n');
  const map = mapLines(answer.map);
  if (answer.form !== undefined)
    return [...(answer.key === undefined ? [] : keyLines(answer.key)), ...formLines(answer.form), ...map].join('\n');
  return toolPageText({
    rows: (answer.rows ?? []).map((row) => ({ label: formRowSaid(row) })),
    total: answer.total ?? 0,
    order: 'by name',
    next: answer.next === null || answer.next === undefined ? undefined : `read_inspections(cursor="${answer.next}")`,
    empty: 'no function this project can use',
    note: [
      '`name` answers one function with its signature; `key` a key tagma.config.ts declares at HEAD, which read_config lists.',
      ...map,
    ].join('\n'),
  });
};

const heldSaid = ({ holders, withheld }: CheckedViolation): string => {
  if (holders !== undefined)
    return `held by ${holders.join(', ')}${withheld === undefined ? '' : `, standing only on ${withheld}, which they hold uncommitted`}`;
  return withheld === undefined ? '' : `standing only on ${withheld}, which this session holds and this change leaves out`;
};

const checkedNote = (one: CheckedViolation): string =>
  [one.owed === true ? 'debt' : '', heldSaid(one)].filter((part) => part !== '').join(', ');

export const checkedText = (answer: Answered<CheckAnswer>): string => {
  if (answer.status !== 'ok') return refusalLines(answer).join('\n');
  const scope =
    answer.over === 'all'
      ? `checked at ${answer.head}`
      : answer.over === 'staged'
        ? answer.head === ''
          ? 'the index could not be judged'
          : `checked the index against ${answer.head}: ${answer.paths.join(', ') || 'no staged paths'}`
        : answer.paths.length === 0
          ? `nothing to check — this session holds nothing the branch does not already carry (HEAD ${answer.head})`
          : `checked this session's change against ${answer.head}: ${answer.paths.join(', ')}`;
  const named = (one: CheckAnswer['rules'][number]) =>
    `${one.rule === '' ? 'the inspection' : one.rule}${one.strictness === undefined ? '' : ` (${one.strictness}, ${triggersSaid(one.on ?? [])})`}`;
  const ran = (one: CheckAnswer['rules'][number]) =>
    one.failed !== undefined
      ? `  ${named(one)} failed after ${seconds(one.ms)}: ${one.failed}`
      : one.reached
        ? `  ${named(one)} ran in ${seconds(one.ms)}`
        : `  ${named(one)} ran nothing: the change reaches none of its reach`;
  const rules = answer.rules.map(ran);
  const failed = answer.refusal?.code === 'inspection-failed' || answer.rules.some((one) => one.failed !== undefined);
  return [
    scope,
    answer.reader === null
      ? 'builtin inspections ran as this server carries them; programs ran from the checkout'
      : `builtin inspections ran as carried by this server, ${provenanceLine(answer.reader)} — a builtin landed after that runs only in a server built from it; programs ran from the checkout`,
    ...(answer.formed === undefined
      ? []
      : [
          answer.paths.length === 0
            ? `the format commands of tagma.config.ts turn the change of ${answer.formed.join(', ')} into what HEAD holds: submit_work answers nothing and carries that form into the working files`
            : `judged in the form the format commands of tagma.config.ts give them, which the working files do not hold yet: ${answer.formed.join(', ')} — every line and count below reads that form, and submit_work carries it into the working files`,
        ]),
    ...(answer.refusal === undefined ? [] : refusalLines(answer.refusal)),
    ...(failed ? ['inspection failed — this check is incomplete'] : []),
    ...(answer.refuses === undefined || answer.paths.length === 0 || (failed && !answer.refuses)
      ? []
      : [
          answer.refuses
            ? 'submit_work would refuse this change: a rule at gate triggered before it finds a new crossing on your own lines, or cannot run'
            : 'submit_work would land this change as far as its rules go',
        ]),
    ...(rules.length === 0 ? [] : [`rules (${rules.length}):`, ...rules]),
    `fingerprints (${answer.fingerprints.length}): ${answer.fingerprints.length === 0 ? 'none' : answer.fingerprints.join(', ')}`,
    ...unjudgedLines(answer.unjudged),
    ...(answer.violations.length === 0 && answer.total === 0
      ? failed
        ? []
        : ['no violation']
      : [
          ...findingLines(answer.violations, '', checkedNote, answer.bodies),
          toolPageFooter({
            rows: answer.violations.map(() => ({ label: '' })),
            total: answer.total,
            order: 'by rule, fingerprint, then file and line',
            next: answer.next === null ? undefined : `check_rules(cursor="${answer.next}") with the same arguments`,
            empty: failed ? 'no findings on this page' : 'no violation',
          }),
        ]),
  ].join('\n');
};

export const modulesText = (answer: Answered<ModulesSet> | (ModulesSet & { readonly status: 'preview' })): string => {
  if (answer.status === 'refused') return refusalLines(answer).join('\n');
  const preview = answer.status === 'preview';
  return [
    ...(preview ? ['preview: no module cards or enforcement written'] : []),
    ...answer.rules.map((one) => {
      const first = one.escaped.slice(0, 3);
      return `${one.rule} ${preview ? 'measured' : 're-measured'} at ${one.head} in ${seconds(one.ms)}: debt ${one.debt.before} → ${one.debt.after}; escaped ${one.escaped.length}${first.length === 0 ? '' : `: ${first.join(', ')}`}`;
    }),
    ...(answer.rules.some((one) => one.escaped.length > 3)
      ? [
          preview
            ? 'full preview: set_module with the same arguments and json: true'
            : 'read_enforcement with a rule pages all its escaped fingerprints',
        ]
      : []),
    ...answer.modules.map((one) => `${preview ? 'would ' : ''}${one.act} ${one.id}${one.card === null ? '' : ` (${one.card})`}`),
    ...(answer.crowded ?? []).map(crowdedLine),
    `graph copy: ${answer.graph ?? 'the machine graph'}`,
    ...(answer.rules.length === 0 ? ['no enforced map rule was re-measured'] : []),
    ...answer.rules.flatMap((one) => [
      ...one.absorbed.map((entry) => `${one.rule} absorbed ${entry.fingerprint} — ${entry.owner}`),
      ...(one.retired.length === 0 ? [] : [`${one.rule} retired: ${one.retired.join(', ')}`]),
    ]),
  ].join('\n');
};
