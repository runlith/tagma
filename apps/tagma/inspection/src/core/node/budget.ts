import type { Applied, Envelope } from '../rule';
import { implementationOf, ruleOf } from './registry';

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

export const unbounded = (): Budget => ({ take: () => undefined });

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

const isCalibratedBuiltin = (builtin: string): boolean => ruleOf(builtin).calibrated === true;

const probeOf = (first: Iterable<string>, rest: Iterable<string>, size: (path: string) => number | undefined): readonly string[] => {
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

const spreadProbe = (paths: readonly string[], sides: readonly ProbeSide[]): Probe => {
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

const fitsCalibration = (calibration: Calibration, files: number, bytes: number): boolean =>
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

const counting = (refusal: (files: number, bytes: number) => EnvelopeExceeded | undefined): Budget => {
  let files = 0;
  let bytes = 0;
  const seen = new Set<string>();
  const take = (more: number, size: number): void => {
    files += more;
    bytes += size;
    const refused = refusal(files, bytes);
    if (refused !== undefined) throw refused;
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

const envelopedBudgetOf = (builtin: string, envelope: Envelope, detail?: (files: number, bytes: number) => string): Budget =>
  counting((files, bytes) =>
    files <= envelope.files && bytes <= envelope.mib * MIB
      ? undefined
      : new EnvelopeExceeded(builtin, files, bytes, envelope, detail?.(files, bytes)),
  );

const probeEnvelope: Envelope = { files: PROBE_MAX_FILES, mib: PROBE_MAX_BYTES / MIB };

export const budgetOf = (builtin: string, calibration: Calibration | undefined): Budget => {
  if (calibration !== undefined)
    return counting((files, bytes) =>
      fitsCalibration(calibration, files, bytes)
        ? undefined
        : new EnvelopeExceeded(
            builtin,
            files,
            bytes,
            calibratedEnvelopeOf(calibration),
            calibratedMessage(builtin, files, bytes, calibration),
          ),
    );
  const rule = ruleOf(builtin);
  if (rule.envelope !== undefined) return envelopedBudgetOf(builtin, rule.envelope);
  if (rule.calibrated !== true) return unbounded();
  return envelopedBudgetOf(
    builtin,
    probeEnvelope,
    (files, bytes) =>
      `${builtin} is not judged: it has not been calibrated in this judgement, so the reading is bounded by its probe (${probeEnvelope.files} files, ${probeEnvelope.mib.toFixed(1)} MiB) — it reaches ${files} files and ${(bytes / MIB).toFixed(1)} MiB, never judged clean`,
  );
};

export type Subject = { readonly files: number; readonly bytes: number };

export const subjectOf = (paths: readonly string[], sides: readonly ProbeSide[]): Subject => {
  let files = 0;
  let bytes = 0;
  for (const side of sides)
    for (const path of new Set(paths)) {
      if (side.object(path) === undefined) continue;
      files += 1;
      bytes += side.size(path) ?? 0;
    }
  return { files, bytes };
};

export const admit = (builtin: string, calibration: Calibration | undefined, subject: Subject): void =>
  budgetOf(builtin, calibration).take(subject.files, subject.bytes);

export type Probe = { readonly held: readonly (readonly string[])[]; readonly files: number; readonly bytes: number };

export type Calibrating =
  | { readonly kind: 'none' }
  | { readonly kind: 'known'; readonly calibration: Calibration }
  | { readonly kind: 'probe'; readonly probe: Probe };

export const calibratingOf = (
  inspection: Applied,
  paths: readonly string[],
  sides: readonly ProbeSide[],
  listed: Iterable<string>,
  known: Calibration | undefined,
): Calibrating => {
  if (!isCalibratedBuiltin(inspection.builtin)) return { kind: 'none' };
  const subject = subjectOf(paths, sides);
  if (known !== undefined && fitsCalibration(known, subject.files, subject.bytes)) return { kind: 'known', calibration: known };
  const { selects } = implementationOf(inspection.builtin);
  const rest = function* (): Iterable<string> {
    for (const path of listed) if (selects(inspection.params, path)) yield path;
  };
  const kept = probeOf(paths, rest(), (path) => sides.reduce((sum, side) => sum + (side.size(path) ?? 0), 0));
  const probe = spreadProbe(kept, sides);
  return probe.files === 0 ? { kind: 'none' } : { kind: 'probe', probe };
};
