import type { Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import { app } from 'electron';
import type { Reporter } from './connection.js';
import type { HeldPage } from './page.js';
import type { RendererStrain } from './strain.js';

const SWEEP_MS = 1_000;

type Pending = { readonly renderer: number; readonly created: number; readonly gone: () => void };

export class HeapCaptures {
  private readonly pending = new Map<symbol, Pending>();
  private sweeping: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly strains: RendererStrain) {}

  capture(page: HeldPage, path: string, reporter: Reporter, id: number): void {
    const renderer = page.contents.getOSProcessId();
    const metric = app.getAppMetrics().find((process) => process.pid === renderer);
    if (metric === undefined) {
      reporter.fail(id, {
        kind: 'refused',
        message: 'the page heap was not captured because its renderer is not running',
        unblock: ['capture_page with what: heap again'],
      });
      return;
    }
    const capture = Symbol();
    const release = this.strains.hold([renderer], { factor: 1, paused: true });
    const finish = (failure: Failure | null) => {
      if (!this.pending.delete(capture)) return;
      release();
      if (this.pending.size === 0 && this.sweeping !== null) {
        clearInterval(this.sweeping);
        this.sweeping = null;
      }
      if (failure === null) reporter.answer(id, null);
      else reporter.fail(id, failure);
    };
    const failed = (error: unknown) =>
      finish({
        kind: 'refused',
        message: `the page heap was not captured: ${String(error)}`,
        unblock: ['capture_page with what: heap again'],
      });
    this.pending.set(capture, { renderer, created: metric.creationTime, gone: () => failed('the captured renderer exited') });
    this.sweeping ??= setInterval(() => this.sweep(), SWEEP_MS);
    try {
      void page.contents.takeHeapSnapshot(path).then(() => finish(null), failed);
    } catch (error) {
      failed(error);
    }
  }

  private sweep(): void {
    const live = new Map(app.getAppMetrics().map((process) => [process.pid, process.creationTime]));
    for (const capture of this.pending.values()) {
      if (live.get(capture.renderer) !== capture.created) capture.gone();
    }
  }
}
