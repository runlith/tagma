import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { ThreadCalibrationSaveFailed } from '@runlith/agent/thread/compaction/calibration';
import { CalibrationProfiles } from '../contract/service/calibration.js';

const PREFIXED = /^(\d+)\/(.+)$/;
const CURRENT_PREFIX = '5';

const read = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

export const calibrationProfiles = (path: string) =>
  CalibrationProfiles.of({
    load: () => {
      const parsed = read(path);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const weights: Record<string, number> = {};
      for (const [key, weight] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
        const prefixed = PREFIXED.exec(key);
        if (prefixed === null) weights[key] = weight;
        else if (prefixed[1] === CURRENT_PREFIX) weights[prefixed[2]!] = weight;
      }
      return weights;
    },
    save: (weights) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, `${JSON.stringify(weights, null, 2)}\n`);
        },
        catch: (cause) => new ThreadCalibrationSaveFailed({ cause }),
      }),
  });
