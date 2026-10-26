import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Effect } from 'effect';
import { pageRows } from '@runlith/paging';
import type { Answer, EngineReport, Refusal, Row, Summary } from '@runlith/navigation/answer';
import { Navigation } from '@runlith/navigation/navigation';
import type { Question, Target } from '@runlith/navigation/question';
import { body, pair } from '../platform/contract/service/body.js';
import { saidLines } from '../platform/contract/service/presentation.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { CheckoutPlaces } from '../workspace/contract/service/checkouts.js';
import { CallerWorkspace } from '../workspace/contract/service/places.js';
import { EngineStates, QueryProject } from './contract/service/engines.js';
import { Settings } from '../settings/contract/service/values.js';
import { navigationEnabled } from './contract/wire/settings.js';
import { ENGINES, NAVIGATION_OPERATIONS as OPS, type NavigationOperationId, ROWS } from './contract/wire/operations.js';

type Naming = {
  readonly root?: string | undefined;
  readonly name?: string | undefined;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
};

const TEXT_COLUMNS = 160;

const shape = (reason: string) =>
  new GateRefusal('target-shape', reason, ['name the symbol with `path` and `line`, or as `Owner.member` without them']);

const targetOf = Effect.fnUntraced(function* (naming: Naming) {
  const name = naming.name;
  if (name === undefined) return yield* shape('no symbol is named');
  if (naming.path !== undefined || naming.line !== undefined) {
    if (naming.path === undefined || naming.line === undefined) return yield* shape('`path` and `line` name the occurrence together');
    return { _tag: 'at', path: naming.path, line: naming.line, name } satisfies Target;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1)
    return yield* shape(`${name} names no owner: without \`path\` and \`line\`, write it as \`Owner.member\``);
  return { _tag: 'member', owner: name.slice(0, dot), member: name.slice(dot + 1) } satisfies Target;
});

const placeOf = Effect.fn('navigation.place')(function* (naming: Naming) {
  const call = yield* yield* CurrentProject;
  const workspace = yield* CallerWorkspace;
  const anchor = naming.root ?? (naming.path !== undefined && isAbsolute(naming.path) ? dirname(naming.path) : undefined);
  const place = yield* (yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: workspace?.root }, anchor);
  if (naming.path === undefined) return place;
  const inside = relative(place.path, resolve(place.path, naming.path));
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
    return yield* new GateRefusal('path-outside-tree', `${naming.path} is not a file of the checkout at ${place.path}`, [
      'name a path inside the checkout, absolute or relative to its root',
    ]);
  return place;
});

const disabled = () =>
  new GateRefusal('navigation-disabled', 'Code navigation is switched off in settings.', [
    `enable ${navigationEnabled.id} in Settings, or with write_setting`,
  ]);

const refused = (refusal: Refusal) => {
  switch (refusal._tag) {
    case 'engine-disabled':
      return disabled();
    case 'ambiguous':
      return new GateRefusal(
        'symbol-ambiguous',
        `several symbols fit: ${refusal.candidates.map((one) => `${one.name} at ${one.path}:${one.line}`).join(', ')}`,
        ['ask again with the `path` and `line` of the one you mean'],
      );
    case 'missing':
      return new GateRefusal('symbol-missing', refusal.detail, ['check the name and the file it is declared or used in']);
    case 'expired':
      return new GateRefusal('answer-expired', 'the answer this cursor read is no longer kept', [
        'ask the question again without the cursor',
      ]);
    case 'bad-cursor':
      return new GateRefusal('bad-cursor', 'this cursor was not handed out by uses', [
        'hand back the cursor an answer of uses gave, unchanged',
      ]);
    case 'search-failed':
      return new GateRefusal('occurrences-unread', refusal.detail, ['ask again once the checkout can be searched']);
    case 'engine-lost':
      return new GateRefusal('engine-lost', refusal.detail, ['ask again: the next question waits for the next engine']);
    case 'engine-failed':
      return new GateRefusal('engine-failed', refusal.detail, [
        'read_navigation names the failure and when the engine starts again; fix its cause and ask again',
      ]);
  }
};

const answered = Effect.fnUntraced(function* (
  asked: Naming & { readonly limit?: number | undefined; readonly cursor?: string | undefined },
  question: Omit<Question, 'target'>,
) {
  const call = yield* yield* CurrentProject;
  const settings = yield* Settings;
  if (!(yield* settings.value(navigationEnabled, call.project.id))) return yield* disabled();
  const navigation = yield* Navigation;
  const limit = pageRows(asked.limit, ROWS, ceilingOf(ROWS));
  if (asked.cursor !== undefined) {
    const page = yield* navigation.page({ cursor: asked.cursor, limit }).pipe(Effect.mapError(refused));
    return { status: 'answered' as const, ...page };
  }
  const target = yield* targetOf(asked);
  const place = yield* placeOf(asked);
  if (!(yield* settings.value(navigationEnabled, place.projectId))) return yield* disabled();
  const answer = yield* navigation.ask({ root: place.path, question: { ...question, target }, limit }).pipe(
    Effect.provideService(QueryProject, place.projectId),
    Effect.catch((failure) =>
      Effect.flatMap(settings.value(navigationEnabled, place.projectId), (enabled) => Effect.fail(enabled ? refused(failure) : disabled())),
    ),
  );
  return { status: 'answered' as const, ...answer };
});

const clipped = (text: string): string => {
  const line = text.trim();
  return line.length > TEXT_COLUMNS ? `${line.slice(0, TEXT_COLUMNS)}…` : line;
};

const rowLine = (row: Row): string => {
  if (row._tag === 'boundary') return `${row.path} unverified (${row.reason}) ×${row.matches}`;
  const at = `${row.path}:${row.line}:${row.column}`;
  if (row._tag === 'unverified') return `${at} unverified (${row.reason})  ${clipped(row.text)}`;
  const within = row.within === null ? '' : ` in ${row.within}`;
  const via = row.via === null ? '' : ` via ${row.via}`;
  return `${at} ${row.kind}${within}${via}  ${clipped(row.text)}`;
};

const engineLines = (engine: EngineReport): readonly string[] => [
  `engine: snapshot ${engine.revision}, ${engine.lag} files changed since${engine.warming ? '; a newer snapshot is warming' : ''}`,
  ...(engine.stale.length === 0
    ? []
    : [`stale: ${engine.stale.join(', ')} changed after the snapshot; verdicts in other files may be outdated`]),
  ...engine.problems.map((one) => `project ${one.project}: ${one.problem} — ${one.detail}`),
];

const summaryLines = (summary: Summary): readonly string[] => [
  ...(summary.partial ? ['search: part of the checkout could not be read; occurrences there are missing from every count'] : []),
  ...(summary.others.matches === 0 ? [] : [`other symbols: ${summary.others.matches} matches of ${summary.others.symbols}`]),
  ...(summary.texts.matches === 0 ? [] : [`in strings or comments: ${summary.texts.matches} matches in ${summary.texts.files} files`]),
  ...(summary.outside.matches === 0 ? [] : [`outside code: ${summary.outside.matches} matches in ${summary.outside.files} files`]),
  ...(summary.boundary.length === 0
    ? ['unverified: none']
    : [`unverified: ${summary.boundary.map((one) => `${one.reason} ×${one.matches} in ${one.files} files`).join(', ')}`]),
];

const heading = (answer: Answer): string => {
  const asked = answer.question.ask === 'uses' ? 'uses of' : 'declaration of';
  const target = answer.question.target;
  const name = target._tag === 'at' ? target.name : `${target.owner}.${target.member}`;
  if (answer.subject === null) return `${asked} ${name}: no symbol resolved`;
  return `${asked} ${answer.subject.name}, declared at ${answer.subject.declarations.map((at) => `${at.path}:${at.line}`).join(', ')}`;
};

const spoken = saidLines((answer: Answer & { readonly status: string }) => [
  heading(answer),
  ...engineLines(answer.engine),
  ...answer.rows.map(rowLine),
  ...summaryLines(answer.summary),
  `${answer.rows.length} of ${answer.total} rows${answer.next === null ? '' : `; next page: cursor ${answer.next}`}`,
]);

export const NAVIGATION_PAIRS = {
  definition: pair(
    OPS.definition,
    body(OPS.definition, {
      execute: (input) => answered(input, { ask: 'definition' }),
      voice: spoken,
    }),
  ),

  uses: pair(
    OPS.uses,
    body(OPS.uses, {
      execute: (input) => answered(input, { ask: 'uses', kinds: input.kinds }),
      voice: spoken,
    }),
  ),

  read_navigation: pair(
    OPS.read_navigation,
    body(OPS.read_navigation, {
      execute: Effect.fnUntraced(function* (input) {
        const reading = yield* (yield* EngineStates).read(pageRows(input.limit, ENGINES, ceilingOf(ENGINES)));
        return { status: 'read' as const, ...reading };
      }),
    }),
  ),
} satisfies Record<NavigationOperationId, unknown>;
