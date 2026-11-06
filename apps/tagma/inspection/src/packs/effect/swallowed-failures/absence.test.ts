import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import { unbounded } from '../../../core/node/budget';
import { type Form, type SwallowedFailuresParams } from './declaration';
import { swallowedFailures } from './implementation';

const path = 'packages/a/read.ts';
const header = "import { Effect, Result, Exit, Option, pipe } from 'effect';";
const params: SwallowedFailuresParams = { base: '', region: ['packages/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] };
const judge = (body: string, allow: SwallowedFailuresParams['allow'] = [], imports = header) => {
  const text = `${imports}\nexport const read = (result) => { ${body} };`;
  const tree: Tree = {
    has: (one) => one === path,
    read: () => text,
    mentions: (words) => new Set(words.some((word) => text.includes(word)) ? [path] : []),
  };
  return swallowedFailures.read({ ...params, allow }, tree, [path], ADAPTERS, unbounded());
};

const cases: readonly { form: Form; bad: string; good: string }[] = [
  {
    form: 'failureConditional',
    bad: "return result._tag === 'Success' ? result.success : null;",
    good: "return result._tag === 'Success' ? result.success : result;",
  },
  {
    form: 'failureReturn',
    bad: "if (result._tag === 'Failure') return []; return result.success;",
    good: "if (result._tag === 'Failure') return new Unreadable(result); return result.success;",
  },
  {
    form: 'getOrElse',
    bad: 'return Result.getOrElse(result, () => new Set());',
    good: 'return Result.getOrElse(result, (failure) => ({ failure }));',
  },
  {
    form: 'optionGetOrElse',
    bad: 'const option = Result.getSuccess(result); return Option.getOrElse(option, () => null);',
    good: 'const option = Result.getSuccess(result); return Option.getOrElse(option, () => ({ _tag: "Unreadable" }));',
  },
  {
    form: 'match',
    bad: 'return Result.match(result, { onSuccess: (value) => value, onFailure: () => ({}) });',
    good: 'return Result.match(result, { onSuccess: (value) => value, onFailure: (failure) => failure });',
  },
];

describe('swallowedFailures: failure becomes absence', () => {
  for (const { form, bad, good } of cases) {
    it(`${form}: refuses absence, preserves typed outcomes, and honors only the exact allowance`, () => {
      const failed = judge(bad);
      expect(failed.violations.map((one) => one.specifier)).toEqual([form]);
      expect(failed.unjudged).toEqual([]);
      expect(judge(good)).toEqual({ violations: [], unjudged: [] });
      const site = failed.violations[0]!.fingerprint.split(' ').at(-1)!;
      const allowed = { path, symbol: 'read', form, site, why: 'The caller records this as unknown and preserves the prior reading.' };
      expect(judge(bad, [allowed])).toEqual({ violations: [], unjudged: [] });
      expect(judge(bad, [{ ...allowed, symbol: 'other' }]).violations).toHaveLength(1);
    });
  }

  it('recognizes every absence literal, including typed empty collections', () => {
    const values = ['null', 'undefined', '[]', 'new Set<string>()', 'new Map<string, string>()', 'false', '0', "''", '{}'];
    for (const value of values)
      expect(judge(`return Result.getOrElse(result, () => (${value}));`).violations.map((one) => one.specifier)).toEqual(['getOrElse']);
    expect(judge('return Result.getOrElse(result, () => [undefined]);').violations).toEqual([]);
    expect(judge('return Result.getOrElse(result, () => new Set([1]));').violations).toEqual([]);
  });

  it('finds structural TextAt tags without an Effect import and predicates in either polarity', () => {
    const tests = [
      "result._tag === 'Success'",
      "'Success' === result._tag",
      "result._tag !== 'Failure'",
      'Result.isSuccess(result)',
      '!Result.isFailure(result)',
      'Exit.isSuccess(result)',
    ];
    for (const test of tests) expect(judge(`return ${test} ? result.success : null;`).violations).toHaveLength(1);
    expect(judge("return result._tag === 'Failure' ? null : result.success;", [], '').violations).toHaveLength(1);
    expect(judge("if (result._tag === 'Success') return result.success; else return null;", [], '').violations).toHaveLength(1);
    expect(judge('if (Result.isFailure(result)) return false; return result.success;').violations).toHaveLength(1);
    expect(judge("return result._tag === 'Success' ? null : result;", [], '').violations).toEqual([]);
    expect(judge('return result.success ? result.success : null;').violations).toEqual([]);
  });

  it('reads every reachable return, while a re-failure or fallthrough keeps a guarded branch from being unconditional absence', () => {
    expect(judge('if (Result.isFailure(result)) { if (retry) return null; return []; }').violations).toHaveLength(1);
    expect(judge('if (Result.isFailure(result)) { if (retry) return null; }').violations).toEqual([]);
    expect(judge('if (Result.isFailure(result)) { if (retry) return null; return result; }').violations).toEqual([]);
    expect(judge('if (Result.isFailure(result)) { throw result; return null; }').violations).toEqual([]);
    expect(judge('return Result.getOrElse(result, () => { if (retry) return null; throw new Unreadable(); });').violations).toEqual([]);
    expect(judge('return Result.getOrElse(result, () => { if (retry) return null; });').violations).toHaveLength(1);
    expect(judge('return Result.getOrElse(result, () => retry ? [] : null);').violations).toHaveLength(1);
    expect(judge('return Result.getOrElse(result, () => { const nested = () => 1; return null; });').violations).toHaveLength(1);
    expect(judge('return Result.getOrElse(result, async () => null);').violations).toEqual([]);
  });

  it('reads imports by their declared receiver, including aliases, namespaces and subpaths', () => {
    expect(
      judge('return R.isFailure(result) ? null : result.success;', [], "import { Result as R } from 'effect';").violations,
    ).toHaveLength(1);
    expect(judge('return Fx.Result.getOrElse(result, () => []);', [], "import * as Fx from 'effect';").violations).toHaveLength(1);
    expect(judge('return R.getOrElse(result, () => []);', [], "import * as R from 'effect/Result';").violations).toHaveLength(1);
    expect(judge('return Result.getOrElse(result, () => []);', [], "import { Result } from 'elsewhere';").violations).toEqual([]);
    expect(judge('return E.isLeft(result) ? null : result.right;', [], "import * as E from 'effect/Either';").violations).toHaveLength(1);
    expect(
      judge('return E.match(result, { onLeft: () => null, onRight: value => value });', [], "import * as E from 'effect/Either';")
        .violations,
    ).toHaveLength(1);
  });

  it('requires a failure producer for Options, following local const bindings and pipe inputs', () => {
    const bodies = [
      'return Option.getOrElse(Result.getSuccess(result), () => null);',
      'const option = Result.getSuccess(result); const alias = option; return alias.pipe(Option.getOrElse(() => null));',
      'return result.pipe(Result.getSuccess, Option.getOrElse(() => null));',
      'return pipe(result, Result.getSuccess, Option.getOrElse(() => null));',
      'return Effect.gen(function* () { const option = yield* Effect.option(reading); return Option.getOrElse(option, () => null); });',
      'return Effect.gen(function* () { const option = yield* reading.pipe(Effect.option); return Option.getOrElse(option, () => null); });',
      'const option = Result.getSuccess(result); return Option.isNone(option) ? null : option.value;',
      "const option = Result.getSuccess(result); if (option._tag === 'None') return null; return option.value;",
      'const option = Result.getSuccess(result); return Option.match(option, { onSome: value => value, onNone: () => null });',
    ];
    for (const body of bodies) expect(judge(body).violations).toHaveLength(1);
    const ordinary = [
      'return Option.getOrElse(option, () => null);',
      'const option = Option.fromNullishOr(result); return Option.getOrElse(option, () => null);',
      'let option = Result.getSuccess(result); option = Option.none(); return Option.getOrElse(option, () => null);',
      'const option = Result.getSuccess(result); return (option) => Option.getOrElse(option, () => null);',
      'const option = Result.getSuccess(result); { const option = Option.none(); return Option.getOrElse(option, () => null); }',
      'const option = Result.getSuccess(result); return option.pipe(Option.orElse(() => Option.some(1)), Option.getOrElse(() => null));',
      "return option._tag === 'None' ? null : option.value;",
      'return Option.match(option, { onSome: value => value, onNone: () => null });',
    ];
    for (const body of ordinary) expect(judge(body).violations).toEqual([]);
  });

  it('preserves condition-specific absence while other failures propagate', () => {
    const body = `if (Result.isFailure(result)) {
      const failure = result.failure;
      if (failure._tag === 'NotFound') return null;
      if (failure.reason._tag === 'NotFound') return [];
      return failure;
    }
    return result.success;`;
    expect(judge(body)).toEqual({ violations: [], unjudged: [] });
    expect(judge('return Result.getOrElse(result, failure => failure._tag === "NotFound" ? null : failure);')).toEqual({
      violations: [],
      unjudged: [],
    });
  });

  it('isolates loop bindings from the surrounding Option provenance', () => {
    expect(
      judge('const option = Result.getSuccess(result); for (const option of options) {} return Option.getOrElse(option, () => null);')
        .violations,
    ).toHaveLength(1);
    expect(
      judge(
        'const option = Option.some(1); for (const option = Result.getSuccess(result); condition; step()) {} return Option.getOrElse(option, () => null);',
      ).violations,
    ).toEqual([]);
  });

  it('leaves failure evidence read elsewhere in the same function unjudged, respecting shadowed bindings and nested functions', () => {
    const retained = [
      'return { value: Result.isSuccess(result) ? result.success : null, failure: Result.isFailure(result) ? result.failure : null };',
      'const value = Result.isSuccess(result) ? result.success : null; return { value, result };',
      'const exit = Result.isSuccess(result) ? result.success : undefined; const detail = Result.isFailure(result) ? result.failure.detail : undefined; return { exit, detail };',
    ];
    for (const body of retained) {
      const reading = judge(body);
      expect(reading.violations).toEqual([]);
      expect(reading.unjudged).toHaveLength(1);
    }
    expect(judge('const saved = () => result.failure; return Result.isSuccess(result) ? result.success : null;').violations).toHaveLength(
      1,
    );
    expect(
      judge(
        'const value = Result.isSuccess(result) ? result.success : null; { const result = other; consume(result.failure); } return value;',
      ).violations,
    ).toHaveLength(1);
    expect(
      judge('return Effect.gen(function* () { if (Result.isFailure(result)) { yield* Effect.fail(result.failure); return null; } });')
        .violations,
    ).toEqual([]);
    expect(judge('if (Result.isFailure(result)) { recordFailure(result.failure); return null; }').violations).toEqual([]);
    const reading = judge(retained[0]!);
    const [form, symbol, site] = reading.unjudged[0]!.specifier.split(' ');
    expect(
      judge(retained[0]!, [
        { path, symbol: symbol!, form: form as Form, site: site!, why: 'The returned failure field preserves the unreadable state.' },
      ]),
    ).toEqual({ violations: [], unjudged: [] });
  });

  it('reads literal match handlers and leaves a spread override or unknown handler undecided', () => {
    expect(judge('return Effect.match(reading, { onSuccess: value => value, onFailure: () => null });').violations).toHaveLength(1);
    expect(judge('return result.pipe(Exit.match({ onSuccess: value => value, onFailure: () => null }));').violations).toHaveLength(1);
    expect(judge('return Result.match(result, { onFailure: () => null, ...handlers });').violations).toEqual([]);
    expect(judge('return Result.match(result, { onFailure: fallback, onSuccess: value => value });').violations).toEqual([]);
  });
});
