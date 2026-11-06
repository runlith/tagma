import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import { ready } from '../../../builtins.node';
import { unbounded } from '../../../core/node/budget';
import type { SwallowedFailuresParams } from './declaration';
import { swallowedFailures } from './implementation';

await ready('swallowed-failures');

const path = 'packages/example/read.ts';
const params: SwallowedFailuresParams = { base: '', region: ['packages/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] };
const judge = (body: string, allow: SwallowedFailuresParams['allow'] = []) => {
  const text = `import { Effect as E, Result as R, Schema as S, pipe } from 'effect';
export const read = E.fnUntraced(function* () { ${body} });`;
  const tree: Tree = {
    has: (one) => one === path,
    read: () => text,
    mentions: (words) => new Set(words.some((word) => text.includes(word)) ? [path] : []),
  };
  return swallowedFailures.read({ ...params, allow }, tree, [path], ADAPTERS, unbounded());
};
const origin = 'const result = yield* E.result(work);';

describe('swallowedFailures: Result recovery contract', () => {
  it('keeps recovery allowances across work and nested projection edits, but judges an edited fallback anew', () => {
    const work = "E.gen(function* () { return 'work-before'; })";
    const fallback = "() => E.succeed({ kind: 'fallback-before', projected: rows.map(row => row.before) })";
    const cases = [
      { form: 'catch' as const, body: `return yield* E.catch(${work}, ${fallback});` },
      { form: 'catchCause' as const, body: `return yield* ${work}.pipe(E.catchCause(${fallback}));` },
      { form: 'catchTag' as const, body: `return yield* E.catchTag(${work}, 'Missing', E.fail, ${fallback});` },
      {
        form: 'catch' as const,
        body: `return yield* E.catch(${work}, () => E.sync(() => ({ kind: 'fallback-before', projected: rows.map(row => row.before) })));`,
      },
      {
        form: 'catch' as const,
        body: `return yield* E.catch(${work}, () => E.void.pipe(E.andThen(() => E.succeed({ kind: 'fallback-before', projected: rows.map(row => row.before) }))));`,
      },
      {
        form: 'catch' as const,
        body: `return yield* E.catch(${work}, () => E.gen(function* () { return yield* E.sync(() => ({ kind: 'fallback-before', projected: rows.map(row => row.before) })); }));`,
      },
      {
        form: 'catch' as const,
        body: `return yield* E.catch(${work}, () => (noted(), E.sync(() => ({ kind: 'fallback-before', projected: rows.map(row => row.before) }))));`,
      },
      {
        form: 'catchCause' as const,
        body: `return yield* E.catchCause(${work}, () => E.gen(function* () { return { kind: 'fallback-before', projected: rows.map(row => row.before) }; }));`,
      },
    ];
    for (const { form, body } of cases) {
      const original = judge(body);
      expect(original.violations).toHaveLength(1);
      const site = original.violations[0]!.fingerprint.split(' ').at(-1)!;
      const allow = [{ path, symbol: 'read', form, site, why: 'Recovery is best-effort after the operation is already decided.' }];
      expect(judge(body.replace('work-before', 'work-after'), allow)).toEqual({ violations: [], unjudged: [] });
      expect(judge(body.replace('row.before', 'row.after'), allow)).toEqual({ violations: [], unjudged: [] });
      expect(judge(body.replace('fallback-before', 'fallback-after'), allow).violations).toHaveLength(1);
    }
  });

  it('keeps a possible fallback body when the tagged overload cannot be decided', () => {
    const body =
      "return yield* E.catchIf(work, predicate, () => E.succeed({ kind: 'fallback-before', projected: rows.map(row => row.before) }));";
    const original = judge(body);
    expect(original.unjudged).toHaveLength(1);
    const site = original.unjudged[0]!.specifier.split(' ').at(-1)!;
    const allow = [
      { path, symbol: 'read', form: 'catchIf' as const, site, why: 'The caller retains the operation as an explicit unknown outcome.' },
    ];
    expect(judge(body.replace('row.before', 'row.after'), allow)).toEqual({ violations: [], unjudged: [] });
    expect(judge(body.replace('fallback-before', 'fallback-after'), allow).unjudged).toHaveLength(1);
  });

  it('preserves the named recovery body when its callable is built by Effect.fn', () => {
    const body =
      "return yield* E.catchCause(work, E.fn('recover')(function* (failure) { return { kind: 'fallback-before', projected: rows.map(row => row.before) }; }));";
    const original = judge(body);
    expect(original.unjudged).toHaveLength(1);
    const site = original.unjudged[0]!.specifier.split(' ').at(-1)!;
    const allow = [
      { path, symbol: 'read', form: 'catchCause' as const, site, why: 'The caller keeps the failed work as an unknown outcome.' },
    ];
    expect(judge(body.replace('row.before', 'row.after'), allow)).toEqual({ violations: [], unjudged: [] });
    expect(judge(body.replace('fallback-before', 'fallback-after'), allow).unjudged).toHaveLength(1);
  });

  it('accepts SchemaError-only parse rejection while still judging arbitrary failures beside it', () => {
    const parser = 'const decode = S.decodeUnknownResult(shape); const parsed = decode(line);';
    for (const body of [
      `${parser} if (parsed._tag === 'Failure') return; return parsed.success;`,
      `${parser} const alias = parsed; return R.isSuccess(alias) ? alias.success : null;`,
      `return R.getOrElse(S.decodeResult(shape)(line), () => []);`,
      `${parser} return R.match(parsed, { onSuccess: value => value, onFailure: () => undefined });`,
      `if (R.isFailure(S.decodeUnknownResult(shape)(line))) return;`,
      `${parser} return parsed.pipe(R.getOrElse(() => []));`,
      `${parser} return pipe(parsed, R.match({ onSuccess: value => value, onFailure: () => null }));`,
    ])
      expect(judge(body)).toEqual({ violations: [], unjudged: [] });
    const rejected = judge(
      `${parser} if (parsed._tag === 'Failure') return; ${origin} if (R.isFailure(result)) return; return result.success;`,
    );
    expect(rejected.violations.map((one) => one.specifier)).toEqual(['failureReturn']);
    expect(rejected.unjudged).toEqual([]);
    for (const body of [
      `${parser} { const parsed = other; if (parsed._tag === 'Failure') return; }`,
      `const decode = S.decodeUnknownResult(shape); { function decode(value) { return R.fail({ _tag: 'NetworkFailed' }); } const parsed = decode(line); if (R.isFailure(parsed)) return; }`,
      `const decode = S.decodeUnknownResult(shape); { const parsed = decode(line); if (R.isFailure(parsed)) return; function decode(value) { return R.fail({ _tag: 'NetworkFailed' }); } }`,
    ])
      expect(judge(body).violations).toHaveLength(1);
  });

  it('refuses silent values, logical defaults, predicates and skipped failure branches with a local failure producer', () => {
    const bad = [
      `${origin} if (result._tag === 'Failure') return true; return result.success;`,
      `${origin} if (result._tag === 'Failure') return platform(); return result.success;`,
      `${origin} if (result._tag === 'Failure' || result.success) return 'tail'; return 'uncertain';`,
      `${origin} return result._tag === 'Success' && result.success !== '' ? result.success : head;`,
      `${origin} target.listeners = result._tag === 'Success' ? result.success : undefined;`,
      `${origin} switch (result._tag) { case 'Failure': return false; case 'Success': return result.success; }`,
      `${origin} if (result._tag === 'Failure' || result.success.status !== 0) return false;`,
      `${origin} return result._tag === 'Success' ? result.success : fallback;`,
      `${origin} return !R.isFailure(result) ? result.success : 'tail';`,
      `${origin} return result._tag === 'Failure' || result.success;`,
      `${origin} return R.isSuccess(result);`,
      `${origin} if (R.isSuccess(result)) count += 1; return count;`,
      `${origin} return R.match(result, { onSuccess: value => value, onFailure: () => fallback });`,
      `${origin} return R.getOrElse(result, () => true);`,
      `return yield* E.map(E.result(work), read => read._tag === 'Success');`,
      `return yield* work.pipe(E.result, E.map(read => read._tag === 'Failure' || read.success));`,
      `return yield* pipe(work, E.result, E.map(read => { if (R.isFailure(read)) return null; return read.success; }));`,
      `return yield* E.flatMap(E.result(work), read => { if (read._tag === 'Failure') return E.succeed(false); return E.succeed(read.success); });`,
      `return yield* E.flatMap(E.result(work), read => { if (read._tag === 'Failure') return E.succeed(E.fail(read.failure)); return E.succeed(read.success); });`,
      `const result = ready ? yield* E.result(work) : null; return result?._tag === 'Success' ? result.success : previous;`,
    ];
    for (const body of bad) {
      const result = judge(body);
      expect({ body, count: result.violations.length }).toEqual({ body, count: 1 });
      expect(result.unjudged).toEqual([]);
    }
  });

  it('preserves typed failures, reason-bearing executed logs and Result data, including later success projections', () => {
    const good = [
      `${origin} if (R.isFailure(result)) return yield* E.fail(result.failure); return result.success;`,
      `${origin} if (R.isSuccess(result)) return result.success; return result;`,
      `${origin} if (R.isFailure(result)) return { _tag: 'Unavailable', reason: \`unreadable: \${result.failure._tag}\` }; return result.success;`,
      `for (const item of items) { ${origin} if (R.isFailure(result)) { yield* E.logWarning('lost', result.failure); continue; } }`,
      `for (const item of items) { ${origin} if (R.isFailure(result)) { if (!(result.failure instanceof Gone)) return yield* E.fail(result.failure); continue; } }`,
      `return yield* work.pipe(E.result, E.map(read => read._tag === 'Success' ? R.succeed(read.success) : R.fail(causeOf(read.failure))));`,
      `${origin} if (R.isSuccess(result)) rows.push(result.success); else problems.push(\`rows: \${reasonOf(result.failure)}\`); return rows;`,
      `${origin} if (R.isFailure(result)) { yield* E.logWarning('stamp cleared', { reason: result.failure.message }); } return R.isSuccess(result) ? result.success : null;`,
      `${origin} if (R.isFailure(result)) return codeOf(result.failure) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unread' }; return result.success;`,
      `return yield* E.flatMap(E.result(work), read => { if (read._tag === 'Failure') return E.succeed(read.failure === 'absent' ? ABSENT : { kind: 'unread' }); return E.succeed(read.success); });`,
      `return yield* work.pipe(E.result, E.flatMap(read => read._tag === 'Failure' ? E.as(E.logWarning('lost', { cause: read.failure }), false) : E.succeed(read.success)));`,
      `${origin} if (R.isFailure(result)) { const failure = result.failure; if (failure._tag === 'NotFound') return null; return yield* new Refused({ reason: failure }); } return result.success;`,
      `${origin} if (R.isFailure(result)) return yield* new Refused({ cause: result.failure }); return result.success;`,
      `${origin} if (R.isFailure(result)) { yield* E.logWarning('lost', result.failure); return false; } return result.success;`,
      `${origin} if (R.isFailure(result)) { yield* logger.warn({ reason: result.failure }); return true; } return result.success;`,
      `${origin} if (R.isFailure(result)) { console.warn(result.failure); } return R.isSuccess(result) ? result.success : null;`,
      `${origin} return R.match(result, { onSuccess: value => value, onFailure: failure => ({ _tag: 'Unreadable', failure }) });`,
      `${origin} return R.getOrElse(result, failure => failure);`,
      `${origin} return result;`,
      `${origin} stored.push(result); return { result };`,
      `${origin} if (R.isFailure(result)) return yield* E.fail(result.failure); return R.isSuccess(result) ? result.success : null;`,
      `const result = yield* work.pipe(E.result); const alias = result; return alias;`,
      `${origin} { const result = other; return R.isSuccess(result) ? result.success : true; }`,
    ];
    for (const body of good) expect(judge(body)).toEqual({ violations: [], unjudged: [] });
  });

  it('does not let conditional, unexecuted or unrelated logging hide a silent failure path', () => {
    const bad = [
      `${origin} if (R.isFailure(result)) { if (verbose) yield* E.logWarning('lost', result.failure); return false; }`,
      `${origin} if (R.isFailure(result)) { E.logWarning('lost', result.failure); return false; }`,
      `${origin} if (R.isFailure(result)) { yield* E.logWarning('lost'); return false; }`,
      `${origin} if (R.isFailure(result)) { const unused = () => console.warn(result.failure); return false; }`,
      `${origin} if (R.isFailure(result)) return !!result.failure;`,
      `${origin} if (R.isFailure(result)) return quiet ? false : (console.warn(result.failure), false);`,
      `${origin} if (verbose) if (R.isFailure(result)) console.warn(result.failure); return R.isSuccess(result);`,
      `if (yield* E.map(E.result(work), result => R.isSuccess(result))) return true; return false;`,
      `${origin} if (R.isFailure(result)) return E.fail(result.failure);`,
      `${origin} if (R.isFailure(result)) return new Date();`,
    ];
    for (const body of bad) expect({ body, count: judge(body).violations.length }).toEqual({ body, count: 1 });
    expect(judge(`${origin} if (R.isFailure(result)) return yield* translate(result.failure); return result.success;`)).toEqual({
      violations: [],
      unjudged: [],
    });
    const unknown = judge(`${origin} if (R.isFailure(result)) return yield* fallback(); return result.success;`);
    expect(unknown.violations).toEqual([]);
    expect(unknown.unjudged).toHaveLength(1);
    const spread = judge(`${origin} return R.match(result, { onFailure: () => false, ...handlers });`);
    expect(spread.violations).toEqual([]);
    expect(spread.unjudged).toHaveLength(1);
  });

  it('keys allowances to the test and the Failure branch: a Success-branch edit keeps the site, a changed fallback is judged anew', () => {
    const body = `${origin} return R.isFailure(result) ? true : result.success;`;
    const result = judge(body);
    const site = result.violations[0]!.fingerprint.split(' ').at(-1)!;
    const allow = [
      { path, symbol: 'read', form: 'failureConditional' as const, site, why: 'The caller records a conservative unknown outcome.' },
    ];
    expect(judge(body, allow)).toEqual({ violations: [], unjudged: [] });
    expect(judge(body.replace(': result.success', ': result.success.trim()'), allow)).toEqual({ violations: [], unjudged: [] });
    expect(judge(body.replace('? true', '? false'), allow).violations).toHaveLength(1);
    expect(judge(body, [{ ...allow[0]!, symbol: 'other' }]).violations).toHaveLength(1);
  });
});
