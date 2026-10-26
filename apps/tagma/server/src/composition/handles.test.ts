import { layer } from '@runlith/effect-test';
import { world } from '@runlith/testbed/worlds';
import { handleOf } from '@runlith/utils/printed';
import { expect } from 'bun:test';
import { Arbitrary, Effect, Schema, SchemaAST } from 'effect';
import { presentationOf, VOICE_BUDGET } from '../invocation/presentation.js';
import { withGraphCall } from '../invocation/testing/call.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { knownAnswer } from '../platform/contract/wire/operation.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { catalogWorld } from './testing/catalogWorld.js';

type Planted = { readonly path: string; readonly printed: string };

const caller: Caller = {
  actor: { kind: 'thread', threadId: 'caller', projectId: 1, principalId: 'caller', session: { harness: 'tagma', key: 'caller' } },
  files: null,
};

const resolved = (ast: SchemaAST.AST): SchemaAST.AST => (SchemaAST.isSuspend(ast) ? resolved(ast.thunk()) : ast);

const childrenOf = (ast: SchemaAST.AST): readonly SchemaAST.AST[] => {
  switch (ast._tag) {
    case 'Objects':
      return [...ast.propertySignatures.map((signature) => signature.type), ...ast.indexSignatures.map((index) => index.type)];
    case 'Arrays':
      return [...ast.elements, ...ast.rest];
    case 'Union':
      return ast.types;
    default:
      return [];
  }
};

const bearing = new Map<SchemaAST.AST, boolean>();

const carries = (declared: SchemaAST.AST): boolean => {
  const ast = resolved(declared);
  const known = bearing.get(ast);
  if (known !== undefined) return known;
  bearing.set(ast, false);
  const found = handleOf(ast) !== undefined || childrenOf(ast).some(carries);
  bearing.set(ast, found);
  return found;
};

const guards = new Map<SchemaAST.AST, (value: unknown) => boolean>();

const direct = (declared: SchemaAST.AST): boolean => {
  const ast = resolved(declared);
  return handleOf(ast) !== undefined || (ast._tag === 'Union' && ast.types.some((member) => handleOf(resolved(member)) !== undefined));
};

const fits = (ast: SchemaAST.AST, value: unknown): boolean => {
  const guard = guards.get(ast) ?? Schema.is(Schema.make(ast));
  guards.set(ast, guard);
  return guard(value);
};

const arbitraries = new Map<SchemaAST.AST, Arbitrary.Arbitrary<unknown>>();

const sampled = (ast: SchemaAST.AST, seed: string): Effect.Effect<unknown, Arbitrary.SampleError> =>
  Effect.suspend(() => {
    try {
      const arbitrary = arbitraries.get(ast) ?? Arbitrary.schema(Schema.make(ast));
      arbitraries.set(ast, arbitrary);
      return Effect.map(Arbitrary.sampleEffect(arbitrary, { count: 1, size: 1, seed }), (values) => values[0]);
    } catch (cause) {
      return Effect.die(new Error(`${seed}: ${String(cause)}`));
    }
  });

const tokens = (index: number): readonly unknown[] => {
  const tail = (index * 7919 + 104_729).toString(36).padStart(6, '0');
  const digits = String(index * 7919 + 104_729).padStart(8, '0');
  return [
    `hq${tail}zx${tail}`,
    `97${digits}`,
    `0198c3d4-7b2a-7f00-8000-${digits}${tail.slice(-4).replace(/[^0-9a-f]/gu, 'e')}`,
    Number(`97${digits}`),
  ];
};

type Coverage = { readonly taken: Map<SchemaAST.AST, Set<SchemaAST.AST>>; fresh: boolean };

const uncovered = (coverage: Coverage, declared: SchemaAST.AST, seen: Set<SchemaAST.AST>): boolean => {
  const ast = resolved(declared);
  if (seen.has(ast) || !carries(ast)) return false;
  seen.add(ast);
  const taken = coverage.taken.get(ast);
  if (ast._tag === 'Union' && ast.types.some((member) => carries(member) && taken?.has(member) !== true)) return true;
  return childrenOf(ast).some((child) => uncovered(coverage, child, seen));
};

const choose = (coverage: Coverage, union: SchemaAST.AST, members: readonly SchemaAST.AST[]): SchemaAST.AST => {
  const taken = coverage.taken.get(union) ?? new Set<SchemaAST.AST>();
  coverage.taken.set(union, taken);
  const untaken = members.find((member) => !taken.has(member));
  if (untaken !== undefined) {
    taken.add(untaken);
    coverage.fresh = true;
    return untaken;
  }
  return members.find((member) => uncovered(coverage, member, new Set())) ?? members[0]!;
};

const plant = Effect.fnUntraced(function* (
  declared: SchemaAST.AST,
  value: unknown,
  path: string,
  coverage: Coverage,
  planted: Planted[],
  above: ReadonlySet<SchemaAST.AST>,
): Generator<Effect.Effect<unknown, Arbitrary.SampleError>, unknown, unknown> {
  const ast = resolved(declared);
  const form = handleOf(ast);
  if (form !== undefined) {
    const token = tokens(planted.length).find((candidate) => fits(ast, candidate));
    if (token === undefined) return yield* Effect.die(new Error(`${path}: no distinct token satisfies this handle type`));
    planted.push({ path, printed: form(token) });
    return token;
  }
  const absent = value === undefined || value === null;
  if (!carries(ast) || (above.has(ast) && absent)) return value;
  const held = absent ? yield* sampled(ast, path) : value;
  const inside = new Set(above).add(ast);
  switch (ast._tag) {
    case 'Union': {
      const members = ast.types.filter((member) => carries(member) && !above.has(resolved(member)));
      if (members.length === 0) return held;
      const member = choose(coverage, ast, members);
      return yield* plant(member, fits(member, held) ? held : yield* sampled(member, path), path, coverage, planted, inside);
    }
    case 'Objects': {
      const object: Record<PropertyKey, unknown> = { ...(held as object) };
      for (const signature of ast.propertySignatures) {
        if (!carries(signature.type) || (above.has(ast) && !direct(signature.type))) continue;
        const key = String(signature.name);
        object[signature.name] = yield* plant(signature.type, object[signature.name], `${path}.${key}`, coverage, planted, inside);
      }
      for (const index of ast.indexSignatures) {
        if (!carries(index.type)) continue;
        for (const key of Object.keys(object))
          object[key] = yield* plant(index.type, object[key], `${path}.${key}`, coverage, planted, inside);
      }
      return object;
    }
    case 'Arrays': {
      const items = [...(held as readonly unknown[])];
      for (const [at, element] of ast.elements.entries())
        items[at] = yield* plant(element, items[at], `${path}[${at}]`, coverage, planted, inside);
      const rest = ast.rest[0];
      if (rest !== undefined && carries(rest)) {
        if (items.length === ast.elements.length) items.push(above.has(resolved(rest)) ? yield* sampled(rest, path) : undefined);
        for (let at = ast.elements.length; at < items.length; at += 1)
          items[at] = yield* plant(rest, items[at], `${path}[${at}]`, coverage, planted, inside);
      }
      return items;
    }
    default:
      return held;
  }
});

layer(world(catalogWorld, null))('operation handles', (it) => {
  it.effect('every agent operation with its own or its module voice prints each handle its known answers carry', () =>
    Effect.gen(function* () {
      const catalog = yield* OperationCatalog;
      const lost: string[] = [];
      for (const id of catalog.registry.ids) {
        const entry = catalog.registry.entry(id);
        if (entry.tool === undefined || entry.answer === undefined) continue;
        if (catalog.bound(id)?.voice === undefined && catalog.presentation(id)?.voice === undefined) continue;
        const voice = presentationOf(catalog, id).voice;
        if (voice === null) continue;
        const known = SchemaAST.toType(knownAnswer(entry.answer).ast);
        const arms = (known._tag === 'Union' ? known.types : [known]).filter(carries);
        if (arms.length === 0) continue;
        const input = yield* sampled(SchemaAST.toType(entry.params.ast), id);
        for (const arm of arms) {
          const coverage: Coverage = { taken: new Map(), fresh: true };
          for (let round = 0; coverage.fresh; round += 1) {
            coverage.fresh = false;
            const planted: Planted[] = [];
            const answer = yield* plant(arm, yield* sampled(arm, `${id}/${round}`), id, coverage, planted, new Set());
            const text = yield* voice(answer, input, { caller, operation: id, budget: VOICE_BUDGET });
            if (typeof text !== 'string') continue;
            for (const handle of planted) if (!text.includes(handle.printed)) lost.push(`${handle.path} (${handle.printed})`);
          }
        }
      }
      expect(lost).toEqual([]);
    }).pipe(
      Effect.provideService(SessionIdentity, { prefix: {}, extras: [] }),
      withGraphCall(Effect.fail(new GateRefusal('no-root', 'the handle check reads no graph', ['none']))),
    ),
  );
});
