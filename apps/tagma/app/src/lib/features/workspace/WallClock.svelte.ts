import { untrack } from 'svelte';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { minuteStart } from '$lib/shared/time.js';

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const DEADLINE_RECHECK_MS = 5_000;

export class WallClock extends Service<WallClock>()('WallClock', { tier: 'app' }) {
  static *make() {
    return new WallClock(yield* Scope);
  }

  now = $state(Date.now());
  minuteNow = $state(this.now);
  minute = $derived(minuteStart(this.now));
  private seconds = 0;
  private minutes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private every: number | null = null;
  private readonly deadlines = new Map<number, number>();
  private alarm: ReturnType<typeof setTimeout> | null = null;
  private alarmAt: number | null = null;

  constructor(scope: Scope) {
    super();
    document.addEventListener('visibilitychange', this.settle);
    scope.defer(() => {
      document.removeEventListener('visibilitychange', this.settle);
      this.deadlines.clear();
      this.disarm();
      this.stop();
    });
  }

  watch(): () => void {
    this.seconds += 1;
    this.tune();
    return () => {
      this.seconds -= 1;
      this.tune();
    };
  }

  watchMinutes(): () => void {
    this.minutes += 1;
    this.tune();
    return () => {
      this.minutes -= 1;
      this.tune();
    };
  }

  watchDeadline(at: number): () => void {
    const wall = Date.now();
    if (!(at > wall)) {
      if (at > untrack(() => this.now)) this.advance(wall);
      return () => {};
    }
    this.deadlines.set(at, (this.deadlines.get(at) ?? 0) + 1);
    if (this.alarmAt === null || at < this.alarmAt) this.schedule(at, wall);
    return () => {
      const left = (this.deadlines.get(at) ?? 0) - 1;
      if (left > 0) this.deadlines.set(at, left);
      else this.deadlines.delete(at);
      if (this.deadlines.size === 0) this.disarm();
    };
  }

  private readonly settle = (): void => {
    this.disarm();
    const wall = Date.now();
    const shown = untrack(() => this.now);
    let next = Infinity;
    let passed = false;
    for (const at of this.deadlines.keys()) {
      if (at > wall) next = Math.min(next, at);
      else {
        passed ||= at > shown;
        this.deadlines.delete(at);
      }
    }
    if (passed) this.advance(wall);
    if (next !== Infinity) this.schedule(next, wall);
  };

  private schedule(at: number, wall: number): void {
    this.disarm();
    this.alarmAt = Math.min(at, wall + DEADLINE_RECHECK_MS);
    this.alarm = setTimeout(this.settle, this.alarmAt - wall);
  }

  private disarm(): void {
    if (this.alarm !== null) clearTimeout(this.alarm);
    this.alarm = null;
    this.alarmAt = null;
  }

  private advance(wall: number): void {
    if (minuteStart(wall) !== minuteStart(untrack(() => this.now))) this.minuteNow = wall;
    this.now = wall;
  }

  private tune(): void {
    const every = this.seconds > 0 ? SECOND_MS : this.minutes > 0 ? MINUTE_MS : null;
    if (every === this.every) return;
    this.stop();
    this.every = every;
    if (every === null) return;
    const wall = Date.now();
    this.now = wall;
    this.minuteNow = wall;
    this.tick();
  }

  private tick(): void {
    const every = this.every;
    if (every === null) return;
    this.timer = setTimeout(
      () => {
        this.advance(Date.now());
        this.tick();
      },
      every - (Date.now() % every),
    );
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.every = null;
  }
}
