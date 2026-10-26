import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import type { Inspection, Params } from '../../../builtins';
import { names } from './declaration';

type NameParams = Params<'names'>;

const standing: NameParams['glossary'][number] = {
  word: 'standing',
  meaning: 'a block neither resting nor replaced',
  owner: 'graph',
  regions: ['graph/**'],
  reserved: false,
  retired: [
    {
      sense: 'a snapshot',
      spelling: 'Standing',
      at: 'any',
      kinds: [],
      replacement: 'state',
      regions: ['**'],
      exempt: { paths: ['graph/**'], names: [] },
    },
  ],
};

const rule = (change: Partial<NameParams> = {}): Inspection => ({
  builtin: 'names',
  params: {
    base: 'src',
    files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
    uncovered: [{ path: 'packages/', until: 'its card' }],
    modules: [],
    services: ['Context.Service'],
    errors: ['Data.TaggedError'],
    checks: {
      F4: { lines: 600, allowances: [{ path: 'big.ts', lines: 900, why: 'one subject' }] },
      S5: { heads: ['Manager'], allows: [], exempt: [] },
      S7a: { exempt: [] },
    },
    glossary: [standing],
    ...change,
  },
});

describe('names parameters', () => {
  it('refuse at decoding a glossary word, a module, a territory entry, an F4 allowance or an F3 exclusion named twice, an id template without the name, and a retirement with both or neither form', () => {
    const decode = Schema.decodeUnknownExit(names.params);
    const params = rule().params as NameParams;
    const gone = standing.retired[0] as NameParams['glossary'][number]['retired'][number];
    expect(decode(params)._tag).toBe('Success');
    expect(decode({ ...params, glossary: [standing, standing] })._tag).toBe('Failure');
    expect(
      decode({
        ...params,
        modules: [
          { id: 'graph', territory: ['graph/'] },
          { id: 'graph', territory: ['core/'] },
        ],
      })._tag,
    ).toBe('Failure');
    expect(
      decode({
        ...params,
        modules: [
          { id: 'graph', territory: ['graph/'] },
          { id: 'core', territory: ['graph'] },
        ],
      })._tag,
    ).toBe('Failure');
    expect(decode({ ...params, checks: { S9: { id: 'tagma/{module}', suffixes: ['Owner'], testing: [], exempt: [] } } })._tag).toBe(
      'Failure',
    );
    const twice = [
      { path: 'x.ts', lines: 800, why: 'x' },
      { path: 'x.ts', lines: 1000, why: 'x' },
    ];
    expect(decode({ ...params, checks: { F4: { lines: 600, allowances: twice } } })._tag).toBe('Failure');
    expect(
      decode({
        ...params,
        checks: {
          F3: {
            lines: 200,
            excluded: [
              { path: 'a.ts', subject: 's', why: 'w' },
              { path: 'a.ts', subject: 's', why: 'w' },
            ],
          },
        },
      })._tag,
    ).toBe('Failure');
    const exception = { path: 'platform/body.ts', name: 'EveryRefusal', why: 'cross-file catalog' };
    const s8 = { conditions: ['Refused'], names: [], exempt: [] };
    expect(decode({ ...params, checks: { S8: { ...s8, notJudged: [exception, exception] } } })._tag).toBe('Failure');
    expect(decode({ ...params, checks: { S8: { ...s8, notJudged: [{ ...exception, path: 'platform/*.ts' }] } } })._tag).toBe('Failure');
    expect(decode({ ...params, checks: { S8: { ...s8, notJudged: [{ ...exception, why: '' }] } } })._tag).toBe('Failure');
    expect(decode({ ...params, glossary: [{ ...standing, retired: [{ ...gone, pattern: '^X$' }] }] })._tag).toBe('Failure');
    const { spelling: _spelling, at: _at, ...bare } = gone;
    expect(decode({ ...params, glossary: [{ ...standing, retired: [bare] }] })._tag).toBe('Failure');
    expect(decode({ ...params, glossary: [{ ...standing, retired: [{ ...bare, pattern: '^Environment(Providers?)$' }] }] })._tag).toBe(
      'Success',
    );
  });
});
