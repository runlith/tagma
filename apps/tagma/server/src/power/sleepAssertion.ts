import { Effect } from 'effect';
import type { SleepAssertionState } from './contract/wire/power.js';

export type SleepFacility =
  | { readonly _tag: 'helper'; readonly program: string; readonly args: readonly string[]; readonly limit: string }
  | { readonly _tag: 'none'; readonly reason: string };

export const CAFFEINATE = '/usr/bin/caffeinate';

const HELPERS: Partial<Record<NodeJS.Platform, (pid: number) => SleepFacility>> = {
  darwin: (pid) => ({
    _tag: 'helper',
    program: CAFFEINATE,
    args: ['-i', '-w', String(pid)],
    limit: 'Only idle sleep is held off: closing the lid on battery, or putting the machine to sleep yourself, still sleeps it.',
  }),
};

export function idleSleepFacility(platform: NodeJS.Platform, pid: number): SleepFacility {
  return HELPERS[platform]?.(pid) ?? { _tag: 'none', reason: `Tagma holds no idle-sleep assertion on ${platform}.` };
}

export class SleepAssertion {
  private child: Bun.Subprocess | null = null;
  private standing: SleepAssertionState;
  private readonly watchers = new Set<(state: SleepAssertionState) => void>();

  constructor(
    private readonly facility: SleepFacility,
    private readonly fork: (work: Effect.Effect<void>) => void,
  ) {
    this.standing = facility._tag === 'none' ? { _tag: 'unavailable', reason: facility.reason } : { _tag: 'released' };
  }

  get state(): SleepAssertionState {
    return this.standing;
  }

  acquire(): SleepAssertionState {
    if (this.facility._tag === 'none' || this.child !== null) return this.standing;
    const facility = this.facility;
    try {
      const child = Bun.spawn([facility.program, ...facility.args], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      });
      this.child = child;
      this.move({ _tag: 'holding' });
      this.fork(this.watchExit(child));
    } catch (cause) {
      this.move({
        _tag: 'failed',
        reason: `${facility.program} could not be started: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    return this.standing;
  }

  release(): SleepAssertionState {
    if (this.facility._tag === 'none') return this.standing;
    const child = this.child;
    this.child = null;
    child?.kill();
    this.move({ _tag: 'released' });
    return this.standing;
  }

  onChange(hook: (state: SleepAssertionState) => void): void {
    this.watchers.add(hook);
  }

  private watchExit(child: Bun.Subprocess): Effect.Effect<void> {
    return Effect.map(
      Effect.promise(() => child.exited),
      (code) => {
        if (this.child !== child) return;
        this.child = null;
        this.move({ _tag: 'failed', reason: `${this.helperName()} exited ${code}.` });
      },
    );
  }

  private helperName(): string {
    return this.facility._tag === 'helper' ? this.facility.program : 'the idle-sleep helper';
  }

  private move(state: SleepAssertionState): void {
    if (state._tag === this.standing._tag && reasonOf(state) === reasonOf(this.standing)) return;
    this.standing = state;
    for (const watcher of this.watchers) watcher(state);
  }
}

function reasonOf(state: SleepAssertionState): string | null {
  return state._tag === 'failed' || state._tag === 'unavailable' ? state.reason : null;
}
