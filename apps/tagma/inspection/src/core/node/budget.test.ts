import { describe, expect, it } from 'bun:test';
import type { Assembled } from '../../builtins';
import {
  admit,
  ASK_BUDGET_MS,
  ASK_CAP_MS,
  ASK_FLOOR_MS,
  budgetOf,
  calibratedEnvelopeOf,
  calibratingOf,
  deriveCalibration,
  askMsOf,
  EnvelopeExceeded,
  PROBE_MAX_BYTES,
  PROBE_MAX_FILES,
  type ProbeSide,
  subjectOf,
} from './budget';
import { ready } from '../../builtins.node';

await ready('call-services');
await ready('swallowed-failures');
await ready('names');
await ready('platforms');
await ready('loads');

const MIB = 1024 * 1024;

const recovery: Assembled = {
  builtin: 'swallowed-failures',
  params: { base: '', region: ['src/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] },
};

const sideOf = (sizes: ReadonlyMap<string, number>, objects: (path: string) => string = (path) => path): ProbeSide => ({
  object: (path) => (sizes.has(path) ? objects(path) : undefined),
  size: (path) => sizes.get(path),
});

describe('calibration derives machine costs without repository ceilings', () => {
  it('attributes the full probe cost to each axis, staying safe on a single sample', () => {
    const cal = deriveCalibration(100, 10, MIB);
    expect(cal.cbMsPerFile).toBe(10);
    expect(cal.dbMsPerMib).toBe(100);
    expect(cal.probeFiles).toBe(10);
    expect(cal.probeMib).toBe(1);
  });

  it('admits an empty subject but refuses extrapolation on an unmeasured axis', () => {
    const empty = deriveCalibration(5, 0, 0);
    expect(() => budgetOf('swallowed-failures', empty).take(0, 0)).not.toThrow();
    expect(() => budgetOf('swallowed-failures', empty).take(1, 0)).toThrow(EnvelopeExceeded);
    const filesOnly = deriveCalibration(5, 16, 0);
    expect(() => budgetOf('swallowed-failures', filesOnly).take(16, 0)).not.toThrow();
    expect(askMsOf(filesOnly, 16, MIB)).toBe(ASK_CAP_MS);
    expect(() => budgetOf('swallowed-failures', filesOnly).take(16, MIB)).toThrow(EnvelopeExceeded);
  });

  it('clamps a zero-time probe to a positive cost instead of an infinite envelope', () => {
    const cal = deriveCalibration(0, 8, 256 * 1024);
    expect(cal.cbMsPerFile).toBeGreaterThan(0);
    expect(cal.dbMsPerMib).toBeGreaterThan(0);
  });

  it('computes T_ask as 10 s plus input cost, capped at 120 s', () => {
    const cal = deriveCalibration(100, 10, MIB);
    expect(askMsOf(cal, 100, 10 * MIB)).toBe(ASK_FLOOR_MS + 1000);
    expect(askMsOf(cal, 100_000, 1000 * MIB)).toBe(ASK_CAP_MS);
    expect(ASK_BUDGET_MS).toBe(ASK_CAP_MS - ASK_FLOOR_MS);
  });

  it('bounds every nonnegative allocation of the measured cost between files and bytes', () => {
    const cal = deriveCalibration(100, 10, MIB);
    for (const [files, mib] of [
      [100, 2],
      [20, 10],
      [100, 10],
    ] as const) {
      const projected = askMsOf(cal, files, mib * MIB) - ASK_FLOOR_MS;
      for (const fileShare of [0, 0.5, 1]) {
        const cost = 100 * (fileShare * (files / 10) + (1 - fileShare) * mib);
        expect(projected).toBeGreaterThanOrEqual(cost);
      }
    }
  });
});

describe('calibrated budgets refuse with the typed envelope, never clean', () => {
  it('projects one probe cost once when admitting a larger mixed subject', () => {
    const cal = deriveCalibration(167.9, 16, 19_355);
    const files = 2114;
    const bytes = Math.ceil(9.7 * MIB);
    expect(askMsOf(cal, files, bytes)).toBeCloseTo(98_232.625, 2);
    const budget = budgetOf('swallowed-failures', cal);
    budget.take(files, bytes);
    expect(() => budget.take(0, Math.ceil(calibratedEnvelopeOf(cal).mib * MIB))).toThrow(EnvelopeExceeded);
  });

  it('charges distinct blobs once and refuses past the linear budget', () => {
    const cal = deriveCalibration(100, 10, MIB);
    const budget = budgetOf('swallowed-failures', cal);
    budget.blob?.('same', 100);
    budget.blob?.('same', 100);
    expect(() => budget.take(calibratedEnvelopeOf(cal).files + 1, 0)).toThrow(EnvelopeExceeded);
  });

  it('admits the mixed subject at the cap and refuses each axis beyond it', () => {
    const cal = deriveCalibration(100, 10, MIB);
    const envelope = calibratedEnvelopeOf(cal);
    const budget = budgetOf('call-services', cal);
    const bytes = Math.floor(envelope.mib * MIB);
    expect(askMsOf(cal, envelope.files, bytes)).toBe(ASK_CAP_MS);
    budget.take(envelope.files, bytes);
    expect(() => budget.take(1, 0)).toThrow(EnvelopeExceeded);
    const byteBound = budgetOf('call-services', cal);
    byteBound.take(envelope.files, bytes);
    expect(() => byteBound.take(0, 1)).toThrow(EnvelopeExceeded);
  });
});

describe('a budget is bounded by its calibration, its declared envelope or its probe', () => {
  it('bounds a calibrated builtin by the probe until it is given a calibration, and by that calibration once given', () => {
    for (const id of ['call-services', 'swallowed-failures', 'names']) {
      expect(() => budgetOf(id, undefined).take(PROBE_MAX_FILES + 1, 0)).toThrow(EnvelopeExceeded);
      expect(() => budgetOf(id, undefined).take(0, PROBE_MAX_BYTES + 1)).toThrow(EnvelopeExceeded);
    }
    expect(() => budgetOf('swallowed-failures', deriveCalibration(20, 10, 512 * 1024)).take(PROBE_MAX_FILES + 1, 0)).not.toThrow();
  });

  it('bounds an enveloped builtin by its declared envelope, and leaves the rest unbounded', () => {
    expect(() => budgetOf('platforms', undefined).take(4_800, 0)).not.toThrow();
    expect(() => budgetOf('platforms', undefined).take(4_801, 0)).toThrow(EnvelopeExceeded);
    expect(() => budgetOf('loads', undefined).take(1_000_000, 1024 * MIB)).not.toThrow();
  });

  it('admits a subject counted on every side that holds it', () => {
    const base = sideOf(new Map([['src/a.ts', 100]]));
    const built = sideOf(
      new Map<string, number>(Array.from({ length: PROBE_MAX_FILES }, (_, at) => [`src/f${at}.ts`, 1] as const)).set('src/a.ts', 200),
    );
    const paths = ['src/a.ts', ...Array.from({ length: PROBE_MAX_FILES - 1 }, (_, at) => `src/f${at}.ts`)];
    const subject = subjectOf(paths, [base, built]);
    expect(subject).toEqual({ files: PROBE_MAX_FILES + 1, bytes: 300 + PROBE_MAX_FILES - 1 });
    expect(() => admit('swallowed-failures', undefined, subject)).toThrow(EnvelopeExceeded);
    expect(() => admit('swallowed-failures', deriveCalibration(20, 10, 512 * 1024), subject)).not.toThrow();
  });
});

describe('the kit picks the probe a calibration is measured on', () => {
  const sizes = (count: number, size: (at: number) => number) =>
    new Map(Array.from({ length: count }, (_, at) => [`src/f${at}.ts`, size(at)] as const));

  it('keeps a small change and fills its probe across the reach within the bounds', () => {
    const reach = sizes(40, () => 10);
    const calibrating = calibratingOf(recovery, ['src/f3.ts'], [sideOf(reach)], reach.keys(), undefined);
    if (calibrating.kind !== 'probe') throw new Error(calibrating.kind);
    expect(calibrating.probe.held[0]).toContain('src/f3.ts');
    expect(calibrating.probe.files).toBe(PROBE_MAX_FILES);
    const heavy = sizes(40, () => PROBE_MAX_BYTES / 2);
    const bounded = calibratingOf(recovery, [], [sideOf(heavy)], heavy.keys(), undefined);
    expect(bounded.kind === 'probe' && bounded.probe.files).toBe(2);
    expect(calibratingOf(recovery, [], [sideOf(new Map())], [], undefined)).toEqual({ kind: 'none' });
  });

  it('calibrates a full reach from both its tiny prefix and its byte-heavy remainder', () => {
    const held = sizes(32, (at) => (at < 16 ? 1 : 32 * 1024));
    const calibrating = calibratingOf(recovery, [...held.keys()], [sideOf(held)], [], undefined);
    if (calibrating.kind !== 'probe') throw new Error(calibrating.kind);
    expect(calibrating.probe.files).toBe(PROBE_MAX_FILES);
    expect(calibrating.probe.bytes).toBeGreaterThan(PROBE_MAX_BYTES / 4);
    expect(calibrating.probe.bytes).toBeLessThanOrEqual(PROBE_MAX_BYTES);
    const calibration = deriveCalibration(229, calibrating.probe.files, calibrating.probe.bytes);
    expect(() => budgetOf('swallowed-failures', calibration).take(1968, Math.ceil(8.9 * MIB))).not.toThrow();
    expect(askMsOf(calibration, 1968, Math.ceil(8.9 * MIB))).toBeLessThan(ASK_CAP_MS);
  });

  it('spreads a probe over every side that holds a path, charging each distinct blob once at its own size', () => {
    const side = (held: Record<string, [string, number]>): ProbeSide => ({
      object: (path) => held[path]?.[0],
      size: (path) => held[path]?.[1],
    });
    const base = side({ 'src/a.ts': ['a1', 100], 'src/same.ts': ['s', 50] });
    const built = side({ 'src/a.ts': ['a2', 3000], 'src/new.ts': ['n', 2000], 'src/same.ts': ['s', 50] });
    const calibrating = calibratingOf(recovery, ['src/a.ts', 'src/new.ts', 'src/same.ts', 'src/gone.ts'], [base, built], [], undefined);
    expect(calibrating).toEqual({
      kind: 'probe',
      probe: {
        held: [
          ['src/a.ts', 'src/same.ts'],
          ['src/a.ts', 'src/new.ts'],
        ],
        files: 4,
        bytes: 100 + 50 + 3000 + 2000,
      },
    });
  });

  it('reuses a known calibration only while it fits the subject, and samples afresh past it', () => {
    const reach = sizes(40, () => 10);
    const narrow = deriveCalibration(ASK_BUDGET_MS / 20, 1, MIB);
    expect(calibratingOf(recovery, [...reach.keys()].slice(0, 20), [sideOf(reach)], [], narrow)).toEqual({
      kind: 'known',
      calibration: narrow,
    });
    expect(calibratingOf(recovery, [...reach.keys()], [sideOf(reach)], [], narrow).kind).toBe('probe');
  });
});

describe('first-judgement bootstrap stays bounded yet measurable', () => {
  it('probes at most the small sample, then judges the full subject in the same ask', () => {
    const probeMs = 40;
    const cal = deriveCalibration(probeMs, PROBE_MAX_FILES, PROBE_MAX_BYTES);
    expect(PROBE_MAX_FILES).toBeLessThanOrEqual(32);
    expect(PROBE_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
    const fullFiles = 500;
    const fullBytes = 3 * 1024 * 1024;
    expect(askMsOf(cal, fullFiles, fullBytes)).toBeLessThan(ASK_CAP_MS);
    expect(askMsOf(cal, fullFiles, fullBytes)).toBeGreaterThan(ASK_FLOOR_MS);
    expect(() => budgetOf('call-services', cal).take(fullFiles, fullBytes)).not.toThrow();
  });

  it('refuses a full reach the probe proves past 120 s, never judging it clean', () => {
    const slow = deriveCalibration(2000, PROBE_MAX_FILES, PROBE_MAX_BYTES);
    expect(() => budgetOf('call-services', slow).take(5000, 50 * 1024 * 1024)).toThrow(EnvelopeExceeded);
  });
});
