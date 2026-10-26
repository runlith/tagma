import { describe, expect, it } from 'bun:test';
import {
  ASK_BUDGET_MS,
  ASK_CAP_MS,
  ASK_FLOOR_MS,
  budgetOf,
  calibratedBudgetOf,
  calibratedEnvelopeOf,
  clearCalibrations,
  deriveCalibration,
  askMsOf,
  EnvelopeExceeded,
  fitsCalibration,
  getCalibration,
  isCalibratedBuiltin,
  PROBE_MAX_BYTES,
  PROBE_MAX_FILES,
  probeOf,
  setCalibration,
  spreadProbe,
} from './budget';
import { ready } from '../../builtins.node';

await ready('call-services');
await ready('swallowed-failures');
await ready('names');
await ready('platforms');
await ready('loads');

const MIB = 1024 * 1024;

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
    expect(fitsCalibration(empty, 0, 0)).toBe(true);
    expect(() => calibratedBudgetOf('swallowed-failures', empty).take(1, 0)).toThrow(EnvelopeExceeded);
    const filesOnly = deriveCalibration(5, 16, 0);
    expect(fitsCalibration(filesOnly, 16, 0)).toBe(true);
    expect(askMsOf(filesOnly, 16, MIB)).toBe(ASK_CAP_MS);
    expect(() => calibratedBudgetOf('swallowed-failures', filesOnly).take(16, MIB)).toThrow(EnvelopeExceeded);
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
    expect(fitsCalibration(cal, files, bytes)).toBe(true);
    const budget = calibratedBudgetOf('swallowed-failures', cal);
    budget.take(files, bytes);
    expect(() => budget.take(0, Math.ceil(calibratedEnvelopeOf(cal).mib * MIB))).toThrow(EnvelopeExceeded);
  });

  it('charges distinct blobs once and refuses past the linear budget', () => {
    const cal = deriveCalibration(100, 10, MIB);
    const budget = calibratedBudgetOf('swallowed-failures', cal);
    budget.blob?.('same', 100);
    budget.blob?.('same', 100);
    expect(() => budget.take(calibratedEnvelopeOf(cal).files + 1, 0)).toThrow(EnvelopeExceeded);
  });

  it('admits the mixed subject at the cap and refuses each axis beyond it', () => {
    const cal = deriveCalibration(100, 10, MIB);
    const envelope = calibratedEnvelopeOf(cal);
    const budget = calibratedBudgetOf('call-services', cal);
    const bytes = Math.floor(envelope.mib * MIB);
    expect(askMsOf(cal, envelope.files, bytes)).toBe(ASK_CAP_MS);
    budget.take(envelope.files, bytes);
    expect(() => budget.take(1, 0)).toThrow(EnvelopeExceeded);
    const byteBound = calibratedBudgetOf('call-services', cal);
    byteBound.take(envelope.files, bytes);
    expect(() => byteBound.take(0, 1)).toThrow(EnvelopeExceeded);
  });
});

describe('budget registry keeps the worker interface unchanged', () => {
  it('marks the calibrated builtins, and leaves platforms on its declared envelope', () => {
    clearCalibrations();
    expect(['call-services', 'swallowed-failures', 'names'].every(isCalibratedBuiltin)).toBe(true);
    expect(isCalibratedBuiltin('platforms')).toBe(false);
  });

  it('preserves a small change and fills its probe across the reach within the bounds', () => {
    const reach = Array.from({ length: 40 }, (_, at) => `src/f${at}.ts`);
    const probe = probeOf(['src/f3.ts'], reach, () => 10);
    expect(probe).toContain('src/f3.ts');
    expect(new Set(probe).size).toBe(PROBE_MAX_FILES);
    expect(probeOf([], reach, () => PROBE_MAX_BYTES / 2).length).toBe(2);
    expect(probeOf([], [], () => 1)).toEqual([]);
  });

  it('calibrates a full reach from both its tiny prefix and its byte-heavy remainder', () => {
    const sizes = new Map<string, number>(Array.from({ length: 32 }, (_, at) => [`src/f${at}.ts`, at < 16 ? 1 : 32 * 1024]));
    const probe = probeOf(sizes.keys(), [], (path) => sizes.get(path));
    const bytes = probe.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
    expect(probe.length).toBe(PROBE_MAX_FILES);
    expect(bytes).toBeGreaterThan(PROBE_MAX_BYTES / 4);
    expect(bytes).toBeLessThanOrEqual(PROBE_MAX_BYTES);
    const calibration = deriveCalibration(229, probe.length, bytes);
    expect(fitsCalibration(calibration, 1968, Math.ceil(8.9 * MIB))).toBe(true);
    expect(askMsOf(calibration, 1968, Math.ceil(8.9 * MIB))).toBeLessThan(ASK_CAP_MS);
  });

  it('spreads a probe over every side that holds a path, charging each distinct blob once at its own size', () => {
    const side = (held: Record<string, [string, number]>) => ({
      object: (path: string) => held[path]?.[0],
      size: (path: string) => held[path]?.[1],
    });
    const base = side({ 'a.ts': ['a1', 100], 'same.ts': ['s', 50] });
    const built = side({ 'a.ts': ['a2', 3 * MIB], 'new.ts': ['n', 2 * MIB], 'same.ts': ['s', 50] });
    expect(spreadProbe(['a.ts', 'new.ts', 'same.ts', 'gone.ts'], [base, built])).toEqual({
      held: [
        ['a.ts', 'same.ts'],
        ['a.ts', 'new.ts'],
      ],
      files: 4,
      bytes: 100 + 50 + 3 * MIB + 2 * MIB,
    });
  });

  it('returns the calibrated budget once the worker stores it, and the probe bound before that', () => {
    clearCalibrations();
    try {
      const before = budgetOf('swallowed-failures', undefined);
      expect(() => before.take(PROBE_MAX_FILES + 1, 0)).toThrow(EnvelopeExceeded);
      expect(() => before.take(0, PROBE_MAX_BYTES + 1)).toThrow(EnvelopeExceeded);
      const cal = deriveCalibration(20, 10, 512 * 1024);
      setCalibration('swallowed-failures', cal);
      expect(getCalibration('swallowed-failures')).toEqual(cal);
      const after = budgetOf('swallowed-failures', undefined);
      expect(() => after.take(PROBE_MAX_FILES + 1, 0)).not.toThrow();
    } finally {
      clearCalibrations();
    }
  });

  it('keeps explicit static envelopes working', () => {
    clearCalibrations();
    try {
      expect(() => budgetOf('swallowed-failures', { files: 1, mib: 1 }).take(2, 0)).toThrow(EnvelopeExceeded);
    } finally {
      clearCalibrations();
    }
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
    expect(fitsCalibration(cal, fullFiles, fullBytes)).toBe(true);
    expect(askMsOf(cal, fullFiles, fullBytes)).toBeLessThan(ASK_CAP_MS);
    expect(askMsOf(cal, fullFiles, fullBytes)).toBeGreaterThan(ASK_FLOOR_MS);
    const budget = calibratedBudgetOf('call-services', cal);
    expect(() => budget.take(fullFiles, fullBytes)).not.toThrow();
  });

  it('refuses a full reach the probe proves past 120 s, never judging it clean', () => {
    const slow = deriveCalibration(2000, PROBE_MAX_FILES, PROBE_MAX_BYTES);
    expect(fitsCalibration(slow, 5000, 50 * 1024 * 1024)).toBe(false);
    expect(() => calibratedBudgetOf('call-services', slow).take(5000, 50 * 1024 * 1024)).toThrow(EnvelopeExceeded);
  });
});
