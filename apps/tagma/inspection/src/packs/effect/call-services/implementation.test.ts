import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import { ready } from '../../../builtins.node';
import { unbounded } from '../../../core/node/budget';
import type { CallServicesParams } from './declaration';
import { callServices } from './implementation';

await ready('call-services');

const params = (change: Partial<CallServicesParams> = {}): CallServicesParams => ({
  base: 'src',
  region: ['door/', 'invocation/'],
  files: { extensions: ['.ts'], exclude: [] },
  tags: [
    { path: 'places/contract.ts', symbol: 'CallerWorkspace' },
    { path: 'writers.ts', symbol: 'SignedCall' },
  ],
  allow: ['invocation/'],
  ...change,
});

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
});

const judged = (texts: Record<string, string>, change: Partial<CallServicesParams> = {}) =>
  callServices
    .read(params(change), tree(texts), Object.keys(texts), ADAPTERS, unbounded())
    .violations.map(({ fingerprint, line }) => `${fingerprint} @${line}`);

const HEAD = [
  "import { Context, Effect, Layer } from 'effect';",
  "import { CallerWorkspace } from '../places/contract.js';",
  "import * as writers from '../writers.js';",
];

const file = (...lines: readonly string[]) => [...HEAD, ...lines, ''].join('\n');

describe('callServices: provision sites', () => {
  it('names each form that provides a listed tag, data-first and pipeable', () => {
    expect(
      judged({
        'src/door/a.ts': file(
          'export const one = (work: Effect.Effect<void>) => Effect.provideService(work, CallerWorkspace, null);',
          'export const two = (work: Effect.Effect<void>) => work.pipe(Effect.provideService(writers.SignedCall, "k"));',
          'export const three = Layer.succeed(CallerWorkspace, null);',
          'export const four = (work: Effect.Effect<void>) => Effect.provide(work, Context.make(CallerWorkspace, null).pipe(Context.add(writers.SignedCall, "k")));',
          'export const five = (work: Effect.Effect<void>) => Effect.provideServiceEffect(work, CallerWorkspace, Effect.succeed(null));',
        ),
      }),
    ).toEqual([
      'door/a.ts one CallerWorkspace Effect.provideService @4',
      'door/a.ts two SignedCall Effect.provideService @5',
      'door/a.ts three CallerWorkspace Layer.succeed @6',
      'door/a.ts four CallerWorkspace Context.make @7',
      'door/a.ts four SignedCall Context.add @7',
      'door/a.ts five CallerWorkspace Effect.provideServiceEffect @8',
    ]);
  });

  it('names in its fix the places allowed to provide the tag', () => {
    const texts = { 'src/door/a.ts': file('export const three = Layer.succeed(CallerWorkspace, null);') };
    expect(callServices.read(params(), tree(texts), Object.keys(texts), ADAPTERS, unbounded()).violations.map(({ fix }) => fix)).toEqual([
      "Provide `CallerWorkspace` only in `invocation/`: hand this call's facts to the code there instead of providing it here.",
    ]);
  });

  it('passes reads, a context built outside a provider, other tags and the allowed places', () => {
    const text = file(
      'export const reads = Effect.map(CallerWorkspace, (place) => place);',
      'export const built = Context.make(CallerWorkspace, null);',
      'export const other = (work: Effect.Effect<void>, Other: never) => Effect.provideService(work, Other, 1);',
    );
    expect(judged({ 'src/door/b.ts': text })).toEqual([]);
    expect(
      judged({
        'src/invocation/c.ts': file(
          'export const own = (work: Effect.Effect<void>) => Effect.provideService(work, CallerWorkspace, null);',
        ),
      }),
    ).toEqual([]);
  });

  it('reads a tag by the file that declares it, never by its name alone', () => {
    const elsewhere = [
      "import { Effect } from 'effect';",
      "import { CallerWorkspace } from '../other/places.js';",
      'export const same = (work: Effect.Effect<void>) => Effect.provideService(work, CallerWorkspace, null);',
      '',
    ].join('\n');
    const declaring = [
      "import { Context, Effect } from 'effect';",
      'export class CallerWorkspace extends Context.Service<CallerWorkspace, null>()("w") {}',
      'export const inside = (work: Effect.Effect<void>) => Effect.provideService(work, CallerWorkspace, null);',
      '',
    ].join('\n');
    expect(judged({ 'src/door/d.ts': elsewhere })).toEqual([]);
    expect(judged({ 'src/places/contract.ts': declaring }, { region: ['places/'] })).toEqual([
      'places/contract.ts inside CallerWorkspace Effect.provideService @3',
    ]);
  });

  it('counts a second site of one owner, tag and form', () => {
    expect(
      judged({
        'src/door/e.ts': file(
          'export const twice = (work: Effect.Effect<void>) => Effect.provideService(Effect.provideService(work, CallerWorkspace, null), CallerWorkspace, null);',
        ),
      }),
    ).toEqual(['door/e.ts twice CallerWorkspace Effect.provideService @4', 'door/e.ts twice CallerWorkspace Effect.provideService#2 @4']);
  });
});
