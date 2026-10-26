import { bordered } from '@runlith/agent/thread/ThreadBorder';
import type { TransportCompaction, TransportRuns } from '@runlith/agent/thread/transport/contract';
import { failedAs } from '../../threads/contract/service/failure.js';
import type { ProtocolCancels } from './cancels.js';
import type { ProtocolDelivery } from './delivery.js';
import type { HostedIntroductions } from './introductions.js';
import type { ProtocolLaunching } from './launching.js';
import type { ProtocolSteps } from './steps.js';

export class ProtocolRuns {
  constructor(
    private readonly launching: ProtocolLaunching,
    private readonly delivery: ProtocolDelivery,
    private readonly cancels: ProtocolCancels,
    private readonly steps: ProtocolSteps,
    private readonly introductions: HostedIntroductions,
  ) {}

  readonly transport: TransportRuns = {
    launch: (launch) => this.launching.launch(launch),
    deliver: (run, items) =>
      bordered(
        this.delivery.deliver(
          run.id,
          run.threadId,
          items.map((item) => item.id),
        ),
      ),
    withdraw: (run, item) => this.delivery.withdraw(run.threadId, item.id),
    queued: (run) => bordered(this.delivery.queued(run.id, run.threadId)),
    holds: (runIds) => this.launching.holds(runIds),
    interrupt: (runId, by) => failedAs('acp.interrupt', this.cancels.interrupt(runId, by)),
    adopt: (candidate) => bordered(this.launching.adopt(candidate)),
    reached: (run, mark) =>
      failedAs('acp.reached', mark === 'all' ? this.steps.sealed(run) : this.introductions.introduced(run.threadId, mark.callId)),
    handed: (run) => failedAs('acp.handed', this.delivery.handed(run.id, run.threadId)),
  };

  readonly compaction: TransportCompaction = {
    compact: (run, keep, mode) => bordered(this.launching.compact(run, keep, mode)),
  };
}
