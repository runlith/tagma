import { resolve } from 'node:path';
import { Console, Effect, Option, Result, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { HttpClientError } from 'effect/http';
import type { CheckAnswer, CheckedViolation, RuleBodies } from '../contract/wire/enforcement.js';
import { findingLines } from '../contract/wire/findings.js';
import { ENFORCEMENT_OPERATIONS } from '../contract/wire/operationCatalog.js';
import type { Performable } from '../../platform/contract/service/perform.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { ALLOW_VARIABLE, GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { VIOLATIONS } from '../contract/wire/pages.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import { end, refusalOf, CurrentInvocation, type Invocation } from '../../platform/cli/verb.js';
import type { EnforcementCli } from './port.js';

export const CHECK_EXIT = { clean: 0, refused: 1, unjudged: 2 } as const;

type Missed = { readonly _tag: 'Unreachable' | 'Unread'; readonly id: string; readonly detail: string };

type Delivered<A> = { readonly _tag: 'Answered'; readonly value: A } | { readonly _tag: 'Refused'; readonly refusal: RefusalBody } | Missed;

const delivered = <D extends Performable>(
  road: EnforcementCli,
  at: Invocation,
  declaration: D,
  input: D['input']['Type'],
): Effect.Effect<Delivered<DeclaredAnswer<D['answer']>>> =>
  Effect.result(road.perform(at)(declaration, input)).pipe(
    Effect.map((answer): Delivered<DeclaredAnswer<D['answer']>> => {
      if (Result.isSuccess(answer)) return { _tag: 'Answered', value: answer.success };
      const refusal = refusalOf(answer.failure);
      if (refusal !== null) return { _tag: 'Refused', refusal };
      if (Schema.isSchemaError(answer.failure)) return { _tag: 'Unread', id: declaration.id, detail: answer.failure.message };
      const detail = HttpClientError.isHttpClientError(answer.failure)
        ? answer.failure.message
        : answer.failure instanceof Error
          ? answer.failure.message
          : String(answer.failure);
      return { _tag: 'Unreachable', id: declaration.id, detail };
    }),
    Effect.catchDefect((defect) =>
      Effect.succeed<Missed>({
        _tag: 'Unreachable',
        id: declaration.id,
        detail: defect instanceof Error ? defect.message : String(defect),
      }),
    ),
  );

const missed = (road: EnforcementCli, at: Invocation, answer: Missed): string =>
  answer._tag === 'Unreachable'
    ? `nothing answers at ${road.baseUrl(at)} (${answer.detail})`
    : `${answer.id} answered outside its declared answer (${answer.detail})`;

const crossingLines = (violations: readonly CheckedViolation[], prefix: string, bodies: RuleBodies | undefined): string[] =>
  findingLines(violations, '  ', (one) => (one.owed === true ? 'debt' : ''), bodies).map((line) => `${prefix}${line}`);

const told = (refusal: RefusalBody): string[] => refusalLines(refusal).flatMap((line) => line.split('\n').map((part) => `tagma: ${part}`));

const said = (lines: readonly string[]) => (lines.length === 0 ? Effect.void : Console.error(lines.join('\n')));

const printed = (json: boolean, value: unknown) => (json ? Console.log(JSON.stringify(value, null, 2)) : Effect.void);

const unjudgedLines = (answer: CheckAnswer): string[] =>
  answer.unjudged.flatMap((one) =>
    'gate' in one ? [`tagma: ${one.cause}`] : 'failed' in one ? [`tagma: ${one.rule}: ${one.failed}`] : [],
  );

const VERDICT: Readonly<Record<number, string>> = {
  [CHECK_EXIT.clean]: 'clean',
  [CHECK_EXIT.refused]: 'refused',
  [CHECK_EXIT.unjudged]: 'unjudged',
};

const verdictOf = (json: boolean) => (code: number) =>
  json ? Effect.succeed(code) : Effect.as(Console.log(VERDICT[code] ?? 'unjudged'), code);

const staged = Effect.fnUntraced(
  function* (road: EnforcementCli, at: Invocation, json: boolean, gate: boolean) {
    const session = (at.env[GRANT_VARIABLE]?.trim() ?? '') !== '';
    const allowed = at.env[ALLOW_VARIABLE]?.trim() === '1';
    const index = at.env.GIT_INDEX_FILE?.trim();
    const ask = { root: at.cwd, index: index === undefined || index === '' ? undefined : resolve(at.cwd, index) };
    const answer = yield* gate && (session || !allowed)
      ? delivered(road, at, ENFORCEMENT_OPERATIONS.gate_commit, ask)
      : delivered(road, at, ENFORCEMENT_OPERATIONS.check_rules, { over: 'staged', ...ask });
    if (answer._tag !== 'Answered') {
      yield* printed(json, answer);
      const why = answer._tag === 'Refused' ? told(answer.refusal) : [`tagma: ${missed(road, at, answer)}`];
      yield* said(
        session
          ? [...why, "tagma: an agent's commit is judged or refused, so this one is refused"]
          : [...why, 'tagma: nothing judged this commit'],
      );
      return session ? CHECK_EXIT.refused : CHECK_EXIT.unjudged;
    }
    const checked = answer.value;
    yield* printed(json, checked);
    const gated = new Set(checked.rules.flatMap((one) => (one.strictness === 'gate' ? [one.rule] : [])));
    const watched = checked.violations.filter((one) => !gated.has(one.rule));
    const notes = [
      ...unjudgedLines(checked),
      ...(watched.length === 0 ? [] : ['tagma: rules at watch found:', ...crossingLines(watched, 'tagma: ', checked.bodies)]),
    ];
    const unjudged = checked.unjudged.length > 0 || checked.rules.some((one) => one.failed !== undefined);
    if (checked.refusal === undefined) {
      yield* said(json ? [] : notes);
      return unjudged ? CHECK_EXIT.unjudged : CHECK_EXIT.clean;
    }
    const refused = told(checked.refusal);
    if (session) {
      yield* said(json ? [] : [...notes, ...refused]);
      return CHECK_EXIT.refused;
    }
    if (allowed) {
      yield* said(
        json
          ? []
          : [
              ...notes,
              ...refused,
              `tagma: ${ALLOW_VARIABLE}=1 lets this commit through; once it lands, each crossing it let in stands as an escape held by the operator until it is removed`,
            ],
      );
      return CHECK_EXIT.clean;
    }
    yield* said(
      json
        ? []
        : [
            ...notes,
            ...refused,
            `tagma: ${ALLOW_VARIABLE}=1 git commit … lands it anyway, and records each crossing it lets in as an escape held by you`,
          ],
    );
    return CHECK_EXIT.refused;
  },
  (effect, road, at, json) => effect.pipe(Effect.flatMap(verdictOf(json))),
);

const everything = Effect.fnUntraced(function* (road: EnforcementCli, at: Invocation, json: boolean) {
  const pages: CheckAnswer[] = [];
  let cursor: string | undefined;
  for (;;) {
    const answer = yield* delivered(road, at, ENFORCEMENT_OPERATIONS.check_rules, {
      over: 'all',
      limit: ceilingOf(VIOLATIONS),
      cursor,
    });
    if (answer._tag !== 'Answered') {
      yield* printed(json, answer);
      yield* said(answer._tag === 'Refused' ? told(answer.refusal) : [`tagma: ${missed(road, at, answer)}`]);
      return CHECK_EXIT.unjudged;
    }
    const page = answer.value;
    pages.push(page);
    if (page.next === null) break;
    cursor = page.next;
  }
  const [first] = pages;
  if (first === undefined) return CHECK_EXIT.unjudged;
  const violations = pages.flatMap((page) => page.violations);
  const bodies = Object.assign({}, ...pages.map((page) => page.bodies ?? {})) as RuleBodies;
  yield* printed(json, { ...first, violations, bodies, shown: violations.length, next: null });
  const gated = new Set(first.rules.flatMap((one) => (one.strictness === 'gate' ? [one.rule] : [])));
  const failed = first.rules.filter((one) => one.failed !== undefined);
  if (!json) {
    yield* Console.log(
      [
        `checked at ${first.head}`,
        ...crossingLines(violations, '', bodies),
        ...failed.map((one) => `  ${one.rule} could not run: ${one.failed}`),
        ...unjudgedLines(first),
      ].join('\n'),
    );
  }
  if (violations.some((one) => one.owed !== true && gated.has(one.rule))) return CHECK_EXIT.refused;
  return failed.length > 0 ? CHECK_EXIT.unjudged : CHECK_EXIT.clean;
});

const landed = Effect.fnUntraced(function* (road: EnforcementCli, at: Invocation, commit: string, json: boolean) {
  const answer = yield* delivered(road, at, ENFORCEMENT_OPERATIONS.record_commit, { root: at.cwd, commit });
  if (answer._tag !== 'Answered') {
    yield* printed(json, answer);
    const why = answer._tag === 'Refused' ? `${answer.refusal.code}: ${answer.refusal.reason}` : missed(road, at, answer);
    yield* said([`tagma: ${why}, so nothing recorded what ${commit.slice(0, 10)} let in`]);
    return CHECK_EXIT.unjudged;
  }
  const { record } = answer.value;
  yield* printed(json, record);
  if (!json && record.unjudged !== undefined) yield* said([`tagma: nothing judges what ${commit.slice(0, 10)} let in: ${record.unjudged}`]);
  return CHECK_EXIT.clean;
});

const all = Flag.Boolean('all').pipe(
  Flag.withDefault(false),
  Flag.withDescription('judge every enforced rule over HEAD instead of what the index would commit'),
);
const landedFlag = Flag.String('landed').pipe(
  Flag.optional,
  Flag.withMetavar('commit'),
  Flag.withDescription(
    'hand a commit that just landed to the server to record what it let in, as the post-commit hook does; answers once it is queued',
  ),
);
const gateFlag = Flag.Boolean('gate').pipe(
  Flag.withDefault(false),
  Flag.withDescription(
    "judge as the commit gate of a `git commit`, as Tagma's hooks call it: a refusal that stops the commit is recorded among the rule's refusals",
  ),
);
const json = Flag.Boolean('json').pipe(Flag.withDefault(false), Flag.withDescription('print the answer as JSON'));

export const check = (road: EnforcementCli) =>
  Command.make('check', { all, landed: landedFlag, gate: gateFlag, json }, (options) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const commit = Option.getOrUndefined(options.landed);
      const code =
        commit !== undefined
          ? yield* landed(road, at, commit, options.json)
          : options.all
            ? yield* everything(road, at, options.json)
            : yield* staged(road, at, options.json, options.gate);
      if (code !== CHECK_EXIT.clean) end(code);
    }),
  ).pipe(Command.withDescription('judge what the index would commit by the enforced rules; exit 0 clean, 1 refused, 2 nothing judged'));
