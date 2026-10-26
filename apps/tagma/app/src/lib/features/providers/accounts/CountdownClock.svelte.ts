import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';

const MINUTE_MS = 60_000;

export class CountdownClock extends Service<CountdownClock>()('CountdownClock', { tier: 'app' }) {
  static *make() {
    return new CountdownClock(yield* Scope);
  }

  now = $state(Date.now());
  private watchers = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(scope: Scope) {
    super();
    scope.defer(() => this.stop());
  }

  watch(): () => void {
    this.watchers += 1;
    if (this.timer === null) {
      this.now = Date.now();
      this.schedule();
    }
    return () => {
      this.watchers -= 1;
      if (this.watchers > 0) return;
      this.stop();
    };
  }

  private schedule(): void {
    this.timer = setTimeout(
      () => {
        this.now = Date.now();
        this.schedule();
      },
      MINUTE_MS - (Date.now() % MINUTE_MS) + 1,
    );
  }

  private stop(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
