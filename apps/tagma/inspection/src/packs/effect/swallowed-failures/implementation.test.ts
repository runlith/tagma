import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import { ready } from '../../../builtins.node';
import { UNBOUNDED } from '../../../core/node/budget';
import { judge } from '../../../core/node/judge';
import type { InspectionMemo, MemoValue } from '../../../core/node/memo';
import type { SwallowedFailuresParams } from './declaration';
import { swallowedFailures } from './implementation';

await ready('swallowed-failures');

const params = (change: Partial<SwallowedFailuresParams> = {}): SwallowedFailuresParams => ({
  base: '',
  region: ['packages/'],
  files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  allow: [],
  ...change,
});

const tree = (texts: Record<string, string>, read: (path: string) => void = () => {}): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    read(path);
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  object: (path) => (Object.hasOwn(texts, path) ? `blob:${Bun.hash(texts[path] as string)}` : undefined),
});

const HEAD = "import { Effect, pipe } from 'effect';";

const file = (...lines: readonly string[]) => [HEAD, ...lines, ''].join('\n');

const digestOf = (fingerprint: string): string => fingerprint.slice(-8);

const judged = (text: string, change: Partial<SwallowedFailuresParams> = {}) => {
  const reading = swallowedFailures.read(params(change), tree({ 'packages/a/x.ts': text }), ['packages/a/x.ts'], ADAPTERS, UNBOUNDED);
  return {
    violations: reading.violations.map(({ fingerprint, line }) => `${fingerprint.replace(/ [0-9a-f]{8}(?=#|$)/, '')} @${line}`),
    unjudged: reading.unjudged.map(({ line, specifier }) => `${specifier.split(' ').slice(0, 2).join(' ')} @${line}`),
  };
};

describe('swallowedFailures: flagged forms', () => {
  it('names every catch-all whose recovery is a success, and ignore and orElseSucceed wherever they stand', () => {
    const text = file(
      'export const words = (read: Effect.Effect<string[], Error>) => read.pipe(Effect.catch(() => Effect.succeed([])));',
      'export const probe = (x: Effect.Effect<boolean, Error>) => x.pipe(Effect.catch(() => Effect.void));',
      'export const noted = (x: Effect.Effect<void, Error>) => x.pipe(Effect.catchCause((cause) => Effect.logWarning("lost", cause)));',
      'export const valued = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(() => Effect.log("x").pipe(Effect.as(0))));',
      'export const first = (x: Effect.Effect<number, Error>) => Effect.catch(x, () => Effect.sync(() => 1));',
      'export const kept = (x: Effect.Effect<number, Error>) => x.pipe(Effect.orElseSucceed(() => 0));',
      'export const gone = (x: Effect.Effect<number, Error>) => x.pipe(Effect.ignore);',
      'export const loud = (x: Effect.Effect<number, Error>) => Effect.ignore(x, { log: true });',
      'export const all = (x: Effect.Effect<number, Error>) => x.pipe(Effect.ignoreCause);',
      'export const chosen = (x: Effect.Effect<number, Error>, fast: boolean) => x.pipe(Effect.catch(() => (fast ? Effect.succeed(0) : Effect.void)));',
      'export const block = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => { console.log(e); return Effect.succeed(0); }));',
      'export const made = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(() => Effect.gen(function* () { yield* Effect.log("x"); return 0; })));',
      'export const piped = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(() => pipe(Effect.log("x"), Effect.andThen(Effect.succeed(0)))));',
      'export const eager = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchEager(() => Effect.succeed(0)));',
      "export const fallback = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchTag('Gone', (e) => Effect.fail(e), () => Effect.succeed(0)));",
      'export const cases = (x: Effect.Effect<number, Error>) => Effect.catchTags(x, { Gone: (e) => Effect.fail(e) }, () => Effect.void);',
    );
    expect(judged(text)).toEqual({
      violations: [
        'packages/a/x.ts words catch @2',
        'packages/a/x.ts probe catch @3',
        'packages/a/x.ts noted catchCause @4',
        'packages/a/x.ts valued catch @5',
        'packages/a/x.ts first catch @6',
        'packages/a/x.ts kept orElseSucceed @7',
        'packages/a/x.ts gone ignore @8',
        'packages/a/x.ts loud ignore @9',
        'packages/a/x.ts all ignoreCause @10',
        'packages/a/x.ts chosen catch @11',
        'packages/a/x.ts block catch @12',
        'packages/a/x.ts made catch @13',
        'packages/a/x.ts piped catch @14',
        'packages/a/x.ts eager catchEager @15',
        'packages/a/x.ts fallback catchTag @16',
        'packages/a/x.ts cases catchTags @17',
      ],
      unjudged: [],
    });
  });

  it('reads Effect through a namespace import of the root barrel and of effect/Effect', () => {
    const root = [
      "import * as Fx from 'effect';",
      'export const x = (e: Fx.Effect.Effect<number, Error>) => e.pipe(Fx.Effect.ignore);',
      '',
    ].join('\n');
    const module = [
      "import * as E from 'effect/Effect';",
      'export const x = (e: E.Effect<number, Error>) => e.pipe(E.catch(() => E.void));',
      '',
    ].join('\n');
    expect(judged(root).violations).toEqual(['packages/a/x.ts x ignore @2']);
    expect(judged(module).violations).toEqual(['packages/a/x.ts x catch @2']);
  });

  it('keys a site by its owning symbol, form and text, so a moved line keeps its fingerprint and a repeated call takes #2', () => {
    const one = file(
      'export class Words {',
      '  read(x: Effect.Effect<number, Error>) {',
      '    Effect.ignore(x); Effect.ignore(x);',
      '  }',
      '}',
    );
    const moved = file(
      '',
      '',
      'export class Words {',
      '  read(x: Effect.Effect<number, Error>) {',
      '    Effect.ignore(x); Effect.ignore(x);',
      '  }',
      '}',
    );
    expect(judged(one).violations).toEqual(['packages/a/x.ts Words.read ignore @4', 'packages/a/x.ts Words.read ignore#2 @4']);
    expect(judged(moved).violations.map((one) => one.split(' @')[0])).toEqual([
      'packages/a/x.ts Words.read ignore',
      'packages/a/x.ts Words.read ignore#2',
    ]);
  });
});

describe('swallowedFailures: exempt forms', () => {
  it('lets tagged catches, re-failing, typed and dying handlers, other receivers and unrelated catch stand', () => {
    const text = file(
      "export const tagged = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchTag('Gone', () => Effect.succeed(0)));",
      'export const tags = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchTags({ Gone: () => Effect.succeed(0) }));',
      "export const firstTag = (x: Effect.Effect<number, Error>) => Effect.catchTag(x, 'Gone', () => Effect.succeed(0));",
      "export const refallen = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchTag('Gone', () => Effect.succeed(0), (e) => Effect.fail(e)));",
      'export const refail = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => Effect.fail(e)));',
      'export const typed = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => new Refused(e)));',
      'export const died = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchCause((cause) => Effect.die(cause)));',
      'export const narrow = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchCause((c) => (interruptsOnly(c) ? Effect.void : Effect.failCause(c))));',
      'export const branch = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => { if (e.kind) return Effect.succeed(0); return Effect.fail(e); }));',
      'export const genned = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => Effect.gen(function* () { if (e.kind) return 0; return yield* new Refused(e); })));',
      'export const after = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch((e) => Effect.andThen(release, Effect.fail(e))));',
      'export const promised = (p: Promise<number>) => p.catch(() => 0);',
      'export const plain = () => { try { return 1; } catch { return 0; } };',
    );
    expect(judged(text)).toEqual({ violations: [], unjudged: [] });
  });

  it('reads no file that binds no Effect, and no file outside the region or excluded as a test', () => {
    const texts = {
      'packages/a/free.ts': 'const Effect = { ignore: 1 };\nexport const x = Effect.ignore;\n',
      'packages/a/x.test.ts': file('export const x = (e: Effect.Effect<number, Error>) => e.pipe(Effect.ignore);'),
      'apps/other/x.ts': file('export const x = (e: Effect.Effect<number, Error>) => e.pipe(Effect.ignore);'),
    };
    const reading = swallowedFailures.read(params(), tree(texts), Object.keys(texts), ADAPTERS, UNBOUNDED);
    expect(reading).toEqual({ violations: [], unjudged: [] });
  });
});

describe('swallowedFailures: unjudged', () => {
  it('an ambiguous tagged overload is decidable when its possible fallback preserves failure, while successful and unknown fallbacks stay unjudged', () => {
    expect(
      judged(
        file(
          'export const refail = (x) => Effect.catchIf(x, predicate, (e) => Effect.fail(e));',
          'export const die = (x) => Effect.catchFilter(x, filter, (e) => Effect.die(e));',
          'export const success = (x) => Effect.catchIf(x, predicate, () => Effect.succeed(0));',
          'export const unknown = (x) => Effect.catchIf(x, predicate, recover);',
        ),
      ),
    ).toEqual({
      violations: [],
      unjudged: ['Effect.catchIf success @4', 'Effect.catchIf unknown @5'],
    });
  });
  it('names a handler the syntax cannot decide instead of passing it', () => {
    const text = file(
      'export const named = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(recover));',
      'export const called = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(() => fallback()));',
      'export const yielded = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catch(() => Effect.gen(function* () { return yield* fallback(); })));',
      'export const passed = [Effect.catch];',
      'export const shaped = (x: Effect.Effect<number, Error>) => Effect.catchIf(x, isGone, () => Effect.succeed(0));',
      'export const cases = (x: Effect.Effect<number, Error>) => Effect.catchTags(x, handlers);',
      'export const namedTag = (x: Effect.Effect<number, Error>) => x.pipe(Effect.catchTag(tag, () => Effect.succeed(0), (e) => Effect.fail(e)));',
      'export const reasons = (x: Effect.Effect<number, Error>) => Effect.catchReasons(x, kinds, () => Effect.void);',
    );
    expect(judged(text)).toEqual({
      violations: [],
      unjudged: [
        'Effect.catch named @2',
        'Effect.catch called @3',
        'Effect.catch yielded @4',
        'Effect.catch passed @5',
        'Effect.catchIf shaped @6',
        'Effect.catchTags cases @7',
        'Effect.catchReasons reasons @9',
      ],
    });
  });
});

describe('swallowedFailures: allowances', () => {
  const text = file(
    'export const release = (x: Effect.Effect<void, Error>) => Effect.andThen(x.pipe(Effect.ignore), y.pipe(Effect.ignore));',
    'export const other = (x: Effect.Effect<void, Error>) => x.pipe(Effect.ignore);',
  );
  const siteOf = (message: string | undefined) => /site ([0-9a-f]{8})/.exec(message ?? '')?.[1] as string;
  const reading = swallowedFailures.read(params(), tree({ 'packages/a/x.ts': text }), ['packages/a/x.ts'], ADAPTERS, UNBOUNDED);
  const first = siteOf(reading.violations[0]?.message);

  it('passes exactly the named site its fix spells, and the site beside it in the same symbol stays a violation', () => {
    expect(reading.violations[0]?.fix).toBe(
      `Recover only the expected tags — \`Effect.catchTag\` or \`catchTags\` with no fallback — and let the rest fail. Where discarding it is the intent, add \`{ path: 'packages/a/x.ts', symbol: 'release', form: 'ignore', site: '${first}', why: '…' }\` to \`allow\`.`,
    );
    const allow = [
      { path: 'packages/a/x.ts', symbol: 'release', form: 'ignore' as const, site: first, why: 'best-effort release after failure' },
    ];
    expect(judged(text, { allow }).violations).toEqual(['packages/a/x.ts release ignore @2', 'packages/a/x.ts other ignore @3']);
  });

  it('stops passing a site whose code changed', () => {
    const allow = [
      { path: 'packages/a/x.ts', symbol: 'release', form: 'ignore' as const, site: first, why: 'best-effort release after failure' },
    ];
    const edited = text.replace('x.pipe(Effect.ignore), y', 'w.pipe(Effect.ignore), y');
    expect(judged(edited, { allow }).violations).toHaveLength(3);
  });

  it('passes a named unjudged site and no other', () => {
    const undecided = file(
      'export const a = (x: Effect.Effect<void, Error>) => Effect.andThen(x.pipe(Effect.catch(recover)), x.pipe(Effect.catch(other)));',
    );
    const read = swallowedFailures.read(params(), tree({ 'packages/a/x.ts': undecided }), ['packages/a/x.ts'], ADAPTERS, UNBOUNDED);
    const site = read.unjudged[0]?.specifier.split(' ')[2] as string;
    expect(judged(undecided, { allow: [{ path: 'packages/a/x.ts', symbol: 'a', form: 'catch', site, why: 'cleanup' }] }).unjudged).toEqual([
      'Effect.catch a @2',
    ]);
  });
});

describe('swallowedFailures: judged against its debt', () => {
  const swallowing = file('export const x = (e: Effect.Effect<number, Error>) => e.pipe(Effect.ignore);');
  const fingerprintsOf = (text: string): readonly string[] => {
    const reading = swallowedFailures.read(params(), tree({ 'packages/a/x.ts': text }), ['packages/a/x.ts'], ADAPTERS, UNBOUNDED);
    return reading.violations.map(({ fingerprint }) => fingerprint);
  };
  const fingerprintOf = (text: string): string => fingerprintsOf(text)[0] as string;
  const judgedChange = (base: Record<string, string>, built: Record<string, string>, debt: readonly string[]) =>
    judge(
      { builtin: 'swallowed-failures', params: params() },
      {
        base: tree(base),
        built: tree(built),
        paths: [...new Set([...Object.keys(base), ...Object.keys(built)])].filter((path) => base[path] !== built[path]),
      },
      debt,
    ).violations.map(({ fingerprint }) => fingerprint);

  it('carries a debt entry with a file moved unchanged, and refuses a second swallow beside it', () => {
    const debt = [fingerprintOf(swallowing)];
    expect(judgedChange({ 'packages/a/x.ts': swallowing }, { 'packages/b/y.ts': swallowing }, debt)).toEqual([]);
    const grown = `${swallowing}export const y = (e: Effect.Effect<number, Error>) => e.pipe(Effect.ignore);\n`;
    expect(judgedChange({ 'packages/a/x.ts': swallowing }, { 'packages/a/x.ts': grown }, debt)).toEqual([
      `packages/a/x.ts y ignore ${digestOf(debt[0] as string)}`,
    ]);
    const pair = file('export const x = (e: Effect.Effect<void, Error>) => Effect.andThen(Effect.ignore(e), Effect.ignore(e));');
    const triple = file(
      'export const x = (e: Effect.Effect<void, Error>) => Effect.andThen(Effect.ignore(e), Effect.ignore(e), Effect.ignore(e));',
    );
    const both = fingerprintsOf(pair);
    expect(both).toEqual([`packages/a/x.ts x ignore ${digestOf(both[0] as string)}`, `${both[0]}#2`]);
    expect(judgedChange({ 'packages/a/x.ts': pair }, { 'packages/a/x.ts': triple }, both)).toEqual([`${both[0]}#3`]);
  });

  it('judges a recovery whose code changed anew, never as the debt of what it replaced', () => {
    const debt = [fingerprintOf(swallowing)];
    const rewritten = swallowing.replace('e.pipe(Effect.ignore)', 'e.pipe(Effect.ignoreCause)');
    expect(judgedChange({ 'packages/a/x.ts': swallowing }, { 'packages/a/x.ts': rewritten }, debt)).toEqual([fingerprintOf(rewritten)]);
  });
});

describe('swallowedFailures: cost', () => {
  it('reads a file once per blob: a second judgement over the same text parses nothing', () => {
    const store = new Map<string, MemoValue>();
    const memo: InspectionMemo = { get: (key) => store.get(key), set: (key, value) => void store.set(key, value) };
    const texts = { 'packages/a/x.ts': file('export const x = (e: Effect.Effect<number, Error>) => e.pipe(Effect.ignore);') };
    let reads = 0;
    const counted = tree(texts, () => {
      reads += 1;
    });
    const first = swallowedFailures.read(params(), counted, ['packages/a/x.ts'], ADAPTERS, UNBOUNDED, memo, 'reach');
    const before = reads;
    const second = swallowedFailures.read(params(), counted, ['packages/a/x.ts'], ADAPTERS, UNBOUNDED, memo, 'reach');
    expect(second).toEqual(first);
    expect(reads).toBe(before);
  });
});
