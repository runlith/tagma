import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { bare, baseOrRoot, defaulted, describeFiles, distinct, entry, filesOrAll, inRegion } from '../../../core/params';
import { recordList, type Shown } from '../../../core/rule';

const languages: Languages = ['js'];

const files = filesOrAll(extensionsOf(languages));

export const ABSENCE_FORMS = ['failureConditional', 'failureReturn', 'getOrElse', 'optionGetOrElse', 'match'] as const;

export const FORMS = [
  'catch',
  'catchEager',
  'catchCause',
  'orElseSucceed',
  'ignore',
  'ignoreCause',
  'catchTag',
  'catchTags',
  'catchReason',
  'catchReasons',
  'catchIf',
  'catchFilter',
  ...ABSENCE_FORMS,
] as const;

export type Form = (typeof FORMS)[number];

export const TOP = '(top)';

const exactFile = entry.check(
  Schema.makeFilter((path) => (path.endsWith('/') || /[?*{}[\]]/.test(path) ? 'an allowance names one exact file' : undefined)),
);

const symbol = Schema.String.check(Schema.isPattern(/^(?:\(top\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)$/u)).annotate({
  description:
    'The owning declaration: a top-level name, or `Top.inner` for the nearest named declaration inside it; `(top)` for a module-level statement.',
});

const Allowance = Schema.Struct({
  path: exactFile,
  symbol,
  form: Schema.Literals(FORMS),
  site: Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}$/u)).annotate({
    description:
      'The site as a violation or an unjudged entry prints it: eight hex digits of the whitespace-normalized recovery form, with nested function bodies omitted except the recovery itself, so an edited fallback needs its reason declared again.',
  }),
  why: Schema.NonEmptyString,
});

type Allowance = typeof Allowance.Type;

export const allowanceKey = (one: {
  readonly path: string;
  readonly symbol: string;
  readonly form: string;
  readonly site: string;
}): string => `${bare(one.path)}\0${one.symbol}\0${one.form}\0${one.site}`;

const params = Schema.Struct({
  base: baseOrRoot,
  region: Schema.NonEmptyArray(entry)
    .check(
      Schema.makeFilter((entries) =>
        !distinct(entries)
          ? 'a region entry is named once'
          : entries.some((one) => !one.endsWith('/'))
            ? 'a region entry is a directory prefix'
            : undefined,
      ),
    )
    .annotate({ description: 'The directory prefixes, relative to `base`, whose selected files are judged; every entry ends in `/`.' }),
  files,
  allow: defaulted(
    Schema.Array(Allowance)
      .check(
        Schema.makeFilter((entries) =>
          new Set(entries.map(allowanceKey)).size === entries.length ? undefined : 'an allowance is named once',
        ),
      )
      .annotate({
        description:
          'Exact allowances: the file relative to `base`, the owning symbol, the form and the site, each with its one-line reason.',
      }),
    [],
  ),
});

export type SwallowedFailuresParams = typeof params.Type;

const describe = (value: SwallowedFailuresParams): string =>
  [
    `Swallowed failures ${describeFiles(value.base, value.files)}, judging files in ${value.region.map((one) => `\`${one}\``).join(', ')}: no \`Effect\` call turns every failure into a success — \`Effect.ignore\`, \`Effect.ignoreCause\` and \`Effect.orElseSucceed\` always; \`Effect.catch\`, \`catchEager\` or \`catchCause\` whose handler recovers only with a success (\`succeed\`, \`succeedNone\`, \`succeedSome\`, \`void\`, \`sync\`, a log, \`as\` or \`asVoid\`, \`ignore\` or \`orElseSucceed\` as its last step); and \`catchTag\`, \`catchTags\`, \`catchReason\`, \`catchReasons\`, \`catchIf\` or \`catchFilter\` whose \`orElse\` fallback does. A handler that can re-fail, fail with a new error or die stands, and so does a tagged catch with no fallback.`,
    'Failure branches also fail when every outcome is absence: `null`, `undefined`, `[]`, `new Set()`, `new Map()`, `false`, `0`, an empty string or object. Over the result of a locally visible `Effect.result`, any value the Failure branch answers without its reason is a violation — `true`, a default, a string, a call that does not receive the failure, a skipped branch, a success-only predicate; the branch stands when it re-fails, keeps the Result, carries the failure into its value or a call, answers an object discriminated by `_tag`, `kind`, `status` or `type`, handles one condition of the failure, or executes a log or record that carries the reason. Sites are `failureConditional`, `failureReturn`, `getOrElse`, `optionGetOrElse` and `match`; Option sites require a syntactically visible failure producer.',
    ...value.allow.map((one) => `Allowed: \`${one.form}\` site \`${one.site}\` in \`${one.symbol}\` at \`${one.path}\` — ${one.why}.`),
  ].join('\n');

const counted = (names: readonly string[]): readonly { readonly name: string; readonly count: number }[] => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
};

const areaOf = (value: SwallowedFailuresParams, path: string): string => {
  const region = value.region.find((one) => path.startsWith(one)) ?? '';
  return `${region}${path.slice(region.length).split('/')[0] ?? ''}`;
};

const shows = (value: SwallowedFailuresParams): Shown => ({
  figures: [
    { kind: 'lists', lists: [{ label: 'Judged in', items: value.region }] },
    ...(value.allow.length === 0
      ? []
      : [
          { kind: 'counts' as const, label: 'Allowed recoveries by form', counts: counted(value.allow.map(({ form }) => form)) },
          {
            kind: 'counts' as const,
            label: 'Allowed recoveries by place',
            counts: counted(value.allow.map(({ path }) => areaOf(value, path))),
          },
        ]),
  ],
});

export const swallowedFailures = {
  id: 'swallowed-failures',
  params,
  summary: 'No Effect recovery in the region turns a failure into success without handling its condition.',
  concern: 'code',
  lists: [recordList('allow', Allowance, ['path', 'symbol', 'form', 'site'], 'path')],
  describe,
  shows,
  relevant: (value: SwallowedFailuresParams, path: string): boolean =>
    inRegion(value, path) && value.files.extensions.some((extension) => path.endsWith(extension)),
  languages,
  reach: 'local',
  fileLocal: true,
  calibrated: true,
  follows: () => true,
  unit: 'recovery site',
  limitations: [
    'Effect recovery sites are calls and point-free references on an imported Effect receiver; point-free `ignore`, `ignoreCause` and `orElseSucceed` are judged and the other recoveries unjudged. Module receivers are named imports from `effect`, namespace or default subpath imports, or members under a namespace import of `effect`. Receivers compare by name, including shadowed names; only non-computed member access is read.',
    'Absence sites are syntactic: ternaries and returning if branches tested by `_tag` against Success/Failure or Right/Left, in either equality polarity, or imported Result/Exit/Either predicates; getOrElse on those modules; and literal match cases with onFailure (onLeft for Either) on them or Effect. Option predicates, Some/None tags, getOrElse and match/onNone are read only with a failure origin. Explicit return, sequential blocks and if branches are followed; every reachable exit must be an absence literal, including implicit undefined in a callback. Throws, typed values, mixed returns, calls or yields before a return, loops, switches, try statements, named callbacks, async and generator callbacks remain outside this absence judgement. A block declaration is followed only when its initializer is a function. Expressions are read through TypeScript assertions and parentheses; other calls and literal aliases are not evaluated. Structural tags and the names undefined, Set and Map are trusted without type or binding resolution.',
    'A candidate becomes unjudged when the same identifier binding is read elsewhere in the same function as a whole value or through failure/cause/error/detail/left. Success/value/right projections and predicate or tag tests do not count. References are indexed once by lexical binding; nested functions are separate. This is a conservative syntactic witness of retained failure, not proof of propagation; aliases, object receivers and interprocedural uses are not followed.',
    'Option failure origins are Effect.option, Result.getSuccess and Either.getRight, directly or as the last point-free pipe step, through yield/await and preceding const bindings in lexical scopes. A data-last Option site reads its immediate pipe input. Function parameters and local declarations shadow those const bindings. Provenance is local syntax, not interprocedural or type-based dataflow; transformations and mutable bindings are outside it.',
    'A handler is read from its syntax alone. It is a violation when every result it returns is a success; it stands when one can be `Effect.fail`, `failSync`, `failCause`, `failCauseSync`, `die`, `interrupt`, `never`, a `new` value, a `throw`, or a `yield*` of any of them; anything else — a handler passed by name, an async or generator handler, a call of another function, a returned `yield*` of an unknown effect — is `unjudged`, never passed. Inside `Effect.gen` a plain returned value, or falling off the end, is a success. A `.pipe` or `pipe` recovers with its last step: `as`, `asVoid`, `ignore`, `ignoreCause` and `orElseSucceed` succeed whatever runs before them, `andThen` and `flatMap` recover with their target, and `map`, `tap`, `mapError` and span or log annotations are read through to the step before. A `sync` thunk, a `map` or a `tap` is trusted not to throw or fail.',
    'A tagged catch is a site only with its `orElse` fallback, found by position. Where the arguments cannot tell the pipeable call from the data-first one, the site is `unjudged` unless the final argument can re-fail by syntax, so neither interpretation is an unconditional recovery: a tag or a case list written as a name rather than a literal, a `catchIf` or `catchFilter` whose first argument is not a function, or any other argument list whose shape fits both readings.',
    'The fingerprint names the file relative to `base`, the owning symbol — the top-level declaration, and the nearest named declaration inside it — and the form, so a moved line or an edit elsewhere keeps it, and a file moved unchanged carries its violations with it; a second site of one form written the same way in one symbol carries `#n` in source order, and a renamed symbol is judged anew. Every violation and unjudged entry prints, after its form, eight hex digits of its whitespace-normalized recovery form. Nested function bodies in wrapped work and projections are omitted; the inline recovery callable and its returned or yielded effect constructors and continuations are retained. Work-body and projection edits keep the site; a changed fallback is judged anew rather than standing as the debt of what it replaced. An allowance names those digits too and covers sites in that file, symbol and form with the same normalized recovery, judged or unjudged.',
    'Result branch sites start at `Effect.result` — called, point-free in a pipe, through yield/await, a const binding, a conditional initializer, or the parameter of a `map` or `flatMap` callback directly after it; destructured tags, boolean aliases of a predicate, mutable bindings and other combinators are not followed. They are `if`, ternary, `switch` on `_tag`, `&&`/`||` guards decided by their left operand, a bare `Result.isSuccess`/`isFailure` or tag comparison outside a test, and `Result.match`/`getOrElse`; Exit, Either and Effect.match stay with the absence judgement. An `if` whose Failure branch falls through is judged with the statements after it in its block. A failure carried means the failure value or a member of it reaches the answered value, a call argument, an array, an object property, a template or an expression-bodied callback; a boolean or comparison of it does not carry it. A condition of the failure is a tag or string comparison, an `instanceof` or a predicate call on it; the other side must still keep it. A log or a recording call or assignment carrying the reason, executed on the path, makes what follows best-effort with its reason. A returned `yield*` of an effect that does not receive the failure is unjudged; a `yield*` statement is a step. A guard that ends every Failure path, or logs on it, discharges later projections of that binding in its scope. The site digest covers the test and the Failure branch only, so an edit of the Success branch keeps the site.',
    'Only files mentioning a recovery form, `_tag` or a success/failure predicate are read; each file’s sites are kept by its blob, so a landing reads only its changed candidate files.',
    'A reading past its calibrated envelope is refused as too large, never judged clean. The envelope is derived on the machine running the server: the first judgement measures a small bounded cold git and parse probe, derives per-file and per-MiB costs, keeps them per repository until the server restarts and reuses them only while the subject fits them — a larger subject or a restarted server measures again — and refuses where 10 s + c_b·F + d_b·MiB would pass 120 s. A reading that measured no probe stays bounded by the probe size, never clean.',
    'A selected file whose text does not parse fails the whole inspection, never reads as a file recovering nothing.',
  ],
  unblock: [
    'Recover only the failures the code expects — `Effect.catchTag` or `catchTags` with no fallback — and let the rest travel the error channel, or re-fail with a typed failure.',
    'Where discarding every failure is the intent — best-effort cleanup, telemetry, release after failure — declare it as an exact allowance in the check’s `allow` — its path, symbol, form and printed site — with its one-line `why`.',
  ],
} as const;
