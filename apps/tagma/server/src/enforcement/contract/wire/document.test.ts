import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import type { Inspection } from '@tagma/inspection/builtins';
import type { ModuleMap } from '@tagma/inspection/rule';
import type { Descriptor } from '../../../config/contract/wire/config.js';
import { lawEnforcementSchema } from '../../../graph/contract/wire/enforcement.js';
import { closedParsing } from '../../../graph/contract/wire/fields.js';
import { type Descriptions, isProgrammed, isUnrun, type Law, type MapReading, readLaw } from './document.js';

const decodeDocument = Schema.decodeUnknownResult(lawEnforcementSchema);
const decode = (input: unknown) => decodeDocument(input, closedParsing);

const SIZE: Inspection = {
  builtin: 'size',
  params: { base: 'src', files: { extensions: ['.ts'], exclude: [] }, thresholds: [{ glob: '**', metric: 'non-import', lines: 650 }] },
};

const MODULES = {
  builtin: 'modules',
  params: {
    base: '',
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    files: { extensions: ['.ts'], exclude: [] },
  },
} as unknown as Inspection;

const PROGRAM: Descriptor = { program: 'tools/check.ts', name: 'forbidden', concern: 'code', needs: [], params: {} };

const MAP: ModuleMap = { modules: [{ id: 'core', territory: ['src/core/'], entries: [] }], relations: [], region: ['src/core/'] };

const described = (entries: Record<string, Descriptor>): Descriptions => ({
  config: { inspections: new Map(Object.entries(entries)), format: [], derive: [], footprint: [] },
});

const stored = (inspection: string, count = 1) => ({
  strictness: 'gate',
  on: [{ op: 'submit_work', phase: 'before' }],
  inspection,
  debt: [{ fingerprint: 'F4 core/a.ts', owner: 'task', count }],
  escaped: [],
});

const read = (document: unknown, descriptions: Descriptions, reading: MapReading | null = null): Law => {
  const envelope = decode(document);
  if (Result.isFailure(envelope)) throw new Error(envelope.failure.message);
  return readLaw(envelope.success, descriptions, reading);
};

describe('the enforcement document enforcement reads', () => {
  test('a key the judged config describes as a builtin reads as that inspection, carrying the debt count to the judgement', () => {
    const law = read(stored('size', 3), described({ size: SIZE }));
    expect(law.check as unknown).toEqual(SIZE);
    expect(law.debt).toEqual([{ fingerprint: 'F4 core/a.ts', owner: 'task', count: 3 }]);
  });

  test('a key described as a program reads as that program under its key', () => {
    const { check } = read(stored('forbidden'), described({ forbidden: PROGRAM }));
    expect(isProgrammed(check) ? check : null).toEqual({ key: 'forbidden', program: PROGRAM });
  });

  test('a key the judged version does not describe reads as unrun naming the key, as does a version without a config or one unread', () => {
    for (const descriptions of [described({ size: SIZE }), { config: null }]) {
      const { check } = read(stored('missing'), descriptions);
      expect(isUnrun(check) && check.unrun).toContain('missing');
    }
    const { check } = read(stored('size'), { unread: 'the config throws' });
    expect(isUnrun(check) && check.unrun).toContain('the config throws');
  });

  test('a document carrying a field this server does not know does not decode', () => {
    expect(Result.isFailure(decode({ ...stored('size'), scope: 'later' }))).toBe(true);
  });

  test('a check taking the module map runs over the map the cards draw, and a map that does not hold together leaves it unrun', () => {
    const descriptions = described({ layered: MODULES });
    expect(read(stored('layered'), descriptions, { map: MAP, problems: [] }).check as unknown).toEqual({
      ...MODULES,
      params: { ...MODULES.params, map: MAP },
    });
    const broken = read(stored('layered'), descriptions, { map: MAP, problems: ['the card a1b2c3d4 carries no module id'] }).check;
    expect(isUnrun(broken) && broken.unrun).toContain('a1b2c3d4');
  });
});
