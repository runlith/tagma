import { Effect } from 'effect';
import { resolveRipgrepPath } from '@runlith/ripgrep';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { CARRIED_RIPGREP, presentCarried } from '../installation/closure/carried.js';

export const ripgrepBinary: RipgrepBinary['Service'] = {
  path: () => {
    const carried = presentCarried(CARRIED_RIPGREP);
    if (carried !== null) return Effect.succeed(carried);
    return Effect.tryPromise({ try: () => resolveRipgrepPath(), catch: (cause) => cause }).pipe(
      Effect.mapError(
        (cause) =>
          new GateRefusal('search-unavailable', cause instanceof Error ? cause.message : String(cause), [
            'install Tagma with its carried ripgrep, or set RUNLITH_RIPGREP_PATH',
          ]),
      ),
    );
  },
};
