import type { Envelope } from '../rule';
import { ruleOf } from './registry';

const MIB = 1024 * 1024;

export class EnvelopeExceeded extends Error {
  constructor(
    readonly builtin: string,
    readonly files: number,
    readonly bytes: number,
    readonly envelope: Envelope,
    detail?: string,
  ) {
    super(
      detail ??
        `${builtin} is not judged: the subject is too large — it reaches ${files} files and ${(bytes / MIB).toFixed(1)} MiB, past its envelope of ${envelope.files} files and ${envelope.mib} MiB`,
    );
    this.name = 'EnvelopeExceeded';
  }
}

export type Budget = {
  readonly take: (files: number, bytes: number) => void;
  readonly blob?: (id: string, bytes: number) => void;
  readonly source?: (id: string, bytes: number) => void;
};

export const UNBOUNDED: Budget = { take: () => undefined };

export const ASK_FLOOR_MS = 10_000;
export const ASK_CAP_MS = 120_000;
export const ASK_BUDGET_MS = ASK_CAP_MS - ASK_FLOOR_MS;

export const PROBE_MAX_FILES = 16;
export const PROBE_MAX_BYTES = 512 * 1024;

export type Calibration = {
  readonly cbMsPerFile: number;
  readonly dbMsPerMib: number;
  readonly probeMs: number;
  readonly probeFiles: number;
  readonly probeMib: number;
};

export const isCalibratedBuiltin = (builtin: string): boolean => ruleOf(builtin).calibrated === true;

export const probeOf = (first: Iterable<string>, rest: Iterable<string>, size: (path: string) => number | undefined): readonly string[] => {
  const kept = new Set<string>();
  let bytes = 0;
  for (const paths of [first, rest]) {
    if (kept.size >= PROBE_MAX_FILES || bytes >= PROBE_MAX_BYTES) break;
    const candidates = [...new Set(paths)].filter((path) => !kept.has(path));
    const count = Math.min(candidates.length, PROBE_MAX_FILES - kept.size);
    for (let at = 0; at < count; at++) {
      if (bytes >= PROBE_MAX_BYTES) break;
      const path = candidates[Math.floor(((at + 0.5) * candidates.length) / count)] as string;
      kept.add(path);
      bytes += size(path) ?? 0;
    }
  }
  return [...kept];
};

export type ProbeSide = {
  readonly object: (path: string) => string | undefined;
  readonly size: (path: string) => number | undefined;
};

export const spreadProbe = (
  paths: readonly string[],
  sides: readonly ProbeSide[],
): { readonly held: readonly (readonly string[])[]; readonly files: number; readonly bytes: number } => {
  const taken = new Set<string>();
  let files = 0;
  let bytes = 0;
  const held = sides.map((side) =>
    paths.filter((path) => {
      const object = side.object(path);
      if (object === undefined || taken.has(object)) return false;
      taken.add(object);
      files += 1;
      bytes += side.size(path) ?? 0;
      return true;
    }),
  );
  return { held, files, bytes };
};

export const deriveCalibration = (probeMs: number, probeFiles: number, probeBytes: number): Calibration => {
  const files = Math.max(0, Math.floor(probeFiles));
  const mib = Math.max(0, probeBytes / MIB);
  const ms = Math.max(probeMs, 1);
  return {
    cbMsPerFile: files > 0 ? ms / files : 0,
    dbMsPerMib: mib > 0 ? ms / mib : 0,
    probeMs: ms,
    probeFiles: files,
    probeMib: mib,
  };
};

const inputCostOf = (calibration: Calibration, files: number, bytes: number): number =>
  Math.max(calibration.cbMsPerFile * files, calibration.dbMsPerMib * (bytes / MIB));

const sampled = (calibration: Calibration, files: number, bytes: number): boolean =>
  (files === 0 || calibration.probeFiles > 0) && (bytes === 0 || calibration.probeMib > 0);

export const askMsOf = (calibration: Calibration, files: number, bytes: number): number =>
  sampled(calibration, files, bytes) ? Math.min(ASK_FLOOR_MS + inputCostOf(calibration, files, bytes), ASK_CAP_MS) : ASK_CAP_MS;

export const fitsCalibration = (calibration: Calibration, files: number, bytes: number): boolean =>
  sampled(calibration, files, bytes) && inputCostOf(calibration, files, bytes) <= ASK_BUDGET_MS + 1e-9;

export const calibratedEnvelopeOf = (calibration: Calibration): Envelope => ({
  files: calibration.cbMsPerFile > 0 ? Math.floor(ASK_BUDGET_MS / calibration.cbMsPerFile) : 0,
  mib: calibration.dbMsPerMib > 0 ? ASK_BUDGET_MS / calibration.dbMsPerMib : 0,
});

const calibratedMessage = (builtin: string, files: number, bytes: number, calibration: Calibration): string => {
  if (!sampled(calibration, files, bytes))
    return `${builtin} is not judged: the subject reaches ${files} files and ${(bytes / MIB).toFixed(1)} MiB, but its probe measured ${calibration.probeFiles} files and ${calibration.probeMib.toFixed(2)} MiB — an unmeasured input axis needs a fresh probe`;
  const envelope = calibratedEnvelopeOf(calibration);
  return `${builtin} is not judged: the subject reaches ${files} files and ${(bytes / MIB).toFixed(1)} MiB, past its calibrated envelope of about ${envelope.files} files and ${envelope.mib.toFixed(1)} MiB (10 s + max(${calibration.cbMsPerFile.toFixed(2)} ms/file·F, ${calibration.dbMsPerMib.toFixed(1)} ms/MiB·MiB) would pass 120 s; measured ${calibration.probeMs.toFixed(1)} ms over ${calibration.probeFiles} files and ${calibration.probeMib.toFixed(2)} MiB on this machine)`;
};

export const calibratedBudgetOf = (builtin: string, calibration: Calibration): Budget => {
  let files = 0;
  let bytes = 0;
  const seen = new Set<string>();
  const take = (more: number, size: number): void => {
    files += more;
    bytes += size;
    if (!fitsCalibration(calibration, files, bytes)) {
      throw new EnvelopeExceeded(
        builtin,
        files,
        bytes,
        calibratedEnvelopeOf(calibration),
        calibratedMessage(builtin, files, bytes, calibration),
      );
    }
  };
  return {
    take,
    source: (id, size) => {
      const fresh = !seen.has(id);
      seen.add(id);
      take(1, fresh ? size : 0);
    },
    blob: (id, size) => {
      if (!seen.has(id)) {
        seen.add(id);
        take(1, size);
      }
    },
  };
};

const fallbackEnvelope: Envelope = { files: PROBE_MAX_FILES, mib: PROBE_MAX_BYTES / MIB };

const fallbackBudgetOf = (builtin: string): Budget => {
  let files = 0;
  let bytes = 0;
  const seen = new Set<string>();
  const take = (more: number, size: number): void => {
    files += more;
    bytes += size;
    if (files > fallbackEnvelope.files || bytes > fallbackEnvelope.mib * MIB) {
      throw new EnvelopeExceeded(
        builtin,
        files,
        bytes,
        fallbackEnvelope,
        `${builtin} is not judged: no calibration is stored on this machine yet, so the reading is bounded by its probe (${fallbackEnvelope.files} files, ${fallbackEnvelope.mib.toFixed(1)} MiB) — it reaches ${files} files and ${(bytes / MIB).toFixed(1)} MiB, never judged clean`,
      );
    }
  };
  return {
    take,
    source: (id, size) => {
      const fresh = !seen.has(id);
      seen.add(id);
      take(1, fresh ? size : 0);
    },
    blob: (id, size) => {
      if (!seen.has(id)) {
        seen.add(id);
        take(1, size);
      }
    },
  };
};

const calibrations = new Map<string, Calibration>();

export const setCalibration = (builtin: string, calibration: Calibration): void => {
  calibrations.set(builtin, calibration);
};

export const getCalibration = (builtin: string): Calibration | undefined => calibrations.get(builtin);

export const clearCalibrations = (): void => {
  calibrations.clear();
};

export const budgetOf = (builtin: string, envelope: Envelope | undefined): Budget => {
  const calibrated = calibrations.get(builtin);
  if (calibrated !== undefined) return calibratedBudgetOf(builtin, calibrated);
  if (envelope !== undefined) {
    let files = 0;
    let bytes = 0;
    const seen = new Set<string>();
    const take = (more: number, size: number): void => {
      files += more;
      bytes += size;
      if (files > envelope.files || bytes > envelope.mib * MIB) throw new EnvelopeExceeded(builtin, files, bytes, envelope);
    };
    return {
      take,
      source: (id, size) => {
        const fresh = !seen.has(id);
        seen.add(id);
        take(1, fresh ? size : 0);
      },
      blob: (id, size) => {
        if (!seen.has(id)) {
          seen.add(id);
          take(1, size);
        }
      },
    };
  }
  if (isCalibratedBuiltin(builtin)) return fallbackBudgetOf(builtin);
  return { take: UNBOUNDED.take };
};
