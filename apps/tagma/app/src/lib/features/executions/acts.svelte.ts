import type { CommandRevisionAnswer, RevisionRefusal } from '@runlith/executions/protocol/command';
import type { ResidualResource, StopReceipt, UnverifiableResource, ProcessTarget, ProcessEnding } from '@runlith/executions/protocol/stop';
import { Service } from '@runlith/layer/key';
import type { LoadPage } from '@tagma/server/executions/contract/wire/load';
import { SvelteMap } from 'svelte/reactivity';
import { Door } from '$lib/wire/Door.js';
import { refusalOf } from '$lib/wire/refusal.js';

export type ProcessOutcome = ProcessEnding | { readonly _tag: 'Unreached'; readonly detail: string };

export type PageClosing = { readonly _tag: 'Closed' } | { readonly _tag: 'Refused'; readonly code: string; readonly reason: string };

export type ExecutionTarget = {
  readonly kind: 'command' | 'terminal';
  readonly execution: { readonly execution: string; readonly incarnation: number };
};

export type StopOutcome =
  | {
      readonly _tag: 'Ended';
      readonly confirmed: number;
      readonly residual: readonly ResidualResource[];
      readonly unverifiable: readonly UnverifiableResource[];
    }
  | { readonly _tag: 'Undecided' }
  | { readonly _tag: 'Refused'; readonly code: string; readonly reason: string };

export type LimitChange = {
  readonly revision: number;
  readonly ceilingMs?: number | undefined;
  readonly executionMs: number;
};

export type LimitOutcome =
  | { readonly _tag: 'Answered'; readonly answer: CommandRevisionAnswer }
  | { readonly _tag: 'Undecided' }
  | { readonly _tag: 'Refused'; readonly code: string; readonly reason: string };

export const REVISION_REFUSALS: Record<RevisionRefusal, string> = {
  'not-armed': 'This command has not started its clock yet; its life is applied as a total.',
  'above-ceiling': 'That is past the longest life its rule allows.',
  'not-a-command': 'This execution was not admitted as a bounded command.',
  conflict: 'That key was already spent on a different change.',
  identity: 'This reference names a host generation that has been replaced.',
};

export type Busy = 'stop' | 'limit';

const endedOf = (receipt: StopReceipt): StopOutcome => ({
  _tag: 'Ended',
  confirmed: receipt.confirmed.length,
  residual: receipt.residual,
  unverifiable: receipt.unverifiable,
});

export class ExecutionActs extends Service<ExecutionActs>()('ExecutionActs', { tier: 'app' }) {
  static *make() {
    return new ExecutionActs(yield* Door);
  }

  private readonly pending = new SvelteMap<string, Busy>();

  constructor(private readonly door: Door) {
    super();
  }

  busy(projectId: number, key: string): Busy | null {
    return this.pending.get(`${projectId}/${key}`) ?? null;
  }

  async stop(projectId: number, key: string, target: ExecutionTarget): Promise<StopOutcome | null> {
    const held = `${projectId}/${key}`;
    if (this.pending.has(held)) return null;
    this.pending.set(held, 'stop');
    const operationId = crypto.randomUUID();
    const address = { ...target.execution, operationId };
    const lens = { project: String(projectId) };
    try {
      const { receipt } =
        target.kind === 'terminal'
          ? await this.door.perform('stop_terminal', { ...address, cause: 'explicit-stop' }, lens)
          : await this.door.perform('stop_command', { ...address, cause: 'explicit-stop' }, lens);
      return endedOf(receipt);
    } catch (error) {
      return await this.failed(projectId, operationId, error);
    } finally {
      this.pending.delete(held);
    }
  }

  async revise(projectId: number, key: string, execution: ExecutionTarget['execution'], change: LimitChange): Promise<LimitOutcome | null> {
    const held = `${projectId}/${key}`;
    if (this.pending.has(held)) return null;
    this.pending.set(held, 'limit');
    const operationId = crypto.randomUUID();
    try {
      const { outcome } = await this.door.perform(
        'change_command_limit',
        {
          ...execution,
          operationId,
          expected: change.revision,
          change: { _tag: 'Total', executionMs: change.executionMs },
          cause: 'operator',
          exceptionMs: change.ceilingMs !== undefined && change.executionMs > change.ceilingMs ? change.executionMs : undefined,
        },
        { project: String(projectId) },
      );
      return { _tag: 'Answered', answer: outcome };
    } catch (error) {
      return await this.failed(projectId, operationId, error);
    } finally {
      this.pending.delete(held);
    }
  }

  async endProcesses(targets: readonly ProcessTarget[]): Promise<readonly ProcessOutcome[]> {
    try {
      return (await this.door.perform('end_machine_process', { targets }, {})).outcomes;
    } catch (error) {
      const refusal = refusalOf(error);
      return [{ _tag: 'Unreached', detail: `${refusal.code}: ${refusal.reason}` }];
    }
  }

  async closePages(pages: readonly LoadPage[]): Promise<readonly PageClosing[]> {
    return await Promise.all(
      pages.map(async ({ page, projectId }): Promise<PageClosing> => {
        try {
          await this.door.perform('close_page', { page }, { project: String(projectId) });
          return { _tag: 'Closed' };
        } catch (error) {
          const refusal = refusalOf(error);
          return { _tag: 'Refused', code: refusal.code, reason: refusal.reason };
        }
      }),
    );
  }

  private async failed(
    projectId: number,
    operationId: string,
    error: unknown,
  ): Promise<{ readonly _tag: 'Undecided' } | { readonly _tag: 'Refused'; readonly code: string; readonly reason: string }> {
    const refusal = refusalOf(error);
    try {
      const { operation } = await this.door.perform('read_terminal_operation', { operationId }, { project: String(projectId) });
      const phase = operation._tag === 'Whole' ? operation.state._tag : operation.digest.phase;
      if (
        phase === 'Admitted' ||
        phase === 'Settled' ||
        phase === 'Pending' ||
        phase === 'Uncertain' ||
        phase === 'admitted' ||
        phase === 'settled' ||
        phase === 'pending' ||
        phase === 'uncertain'
      ) {
        return { _tag: 'Undecided' };
      }
    } catch (unread) {
      return { _tag: 'Refused', code: refusal.code, reason: `${refusal.reason} Its state could not be read: ${refusalOf(unread).reason}` };
    }
    return { _tag: 'Refused', code: refusal.code, reason: refusal.reason };
  }
}
