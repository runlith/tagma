import type { LoadProcess, LoadRow } from '@tagma/server/executions/contract/wire/load';
import type { ProcessTarget } from '@runlith/executions/protocol/stop';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { ExecutionActs, type ProcessOutcome, type StopOutcome } from '../acts.svelte.js';
import { Readings } from './Readings.svelte.js';

export type Ending = { readonly text: string; readonly hint: string; readonly failed: boolean };

const SHOWN_MS = 12_000;

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 'es'}`;

export const processEnding = (outcomes: readonly ProcessOutcome[]): Ending => {
  const ended = outcomes.filter((one) => one._tag === 'Ended').length;
  const survived = outcomes.filter((one) => one._tag === 'Survived').length;
  const refused = outcomes.flatMap((one) =>
    one._tag === 'Refused' ? [`pid ${one.target.identity.pid}: ${one.detail}`] : one._tag === 'Unreached' ? [one.detail] : [],
  );
  const failed = survived + refused.length > 0;
  const text = !failed ? 'ended' : survived > 0 ? `${survived} still running` : 'not ended';
  const lines = [
    ...(ended > 0 ? [`${plural(ended, 'process')} ended`] : []),
    ...(survived > 0 ? [`${plural(survived, 'process')} survived terminate and kill`] : []),
    ...refused,
  ];
  return { text, hint: lines.join('\n'), failed };
};

const workEnding = (stops: readonly StopOutcome[], residuals: Ending | null): Ending => {
  const refused = stops.flatMap((one) => (one._tag === 'Refused' ? [`${one.code}: ${one.reason}`] : []));
  const left = stops.reduce((sum, one) => sum + (one._tag === 'Ended' ? one.residual.length : 0), 0);
  const unproven = stops.reduce((sum, one) => sum + (one._tag === 'Ended' ? one.unverifiable.length : 0), 0);
  const pending = stops.some((one) => one._tag === 'Undecided');
  const confirmed = stops.reduce((sum, one) => sum + (one._tag === 'Ended' ? one.confirmed : 0), 0);
  const failed = refused.length > 0 || left > 0 || unproven > 0 || residuals?.failed === true;
  const text = failed
    ? left > 0
      ? `stopped · ${left} left running`
      : refused.length > 0
        ? 'not stopped'
        : unproven > 0
          ? 'ending not confirmed'
          : residuals!.text
    : pending
      ? 'stopping'
      : 'stopped';
  const lines = [
    ...(confirmed > 0 ? [`${plural(confirmed, 'process')} confirmed ended`] : []),
    ...(left > 0 ? [`${left} left running after the stop`] : []),
    ...(unproven > 0 ? [`the ending of ${unproven} ${unproven === 1 ? 'resource' : 'resources'} could not be measured`] : []),
    ...(pending ? ['A stop was sent; its ending is not known yet.'] : []),
    ...refused,
    ...(residuals === null ? [] : [residuals.hint]),
  ];
  return { text, hint: lines.join('\n'), failed };
};

type Shown = Ending & { readonly at: number; readonly title: string };

export type Departed = Ending & { readonly key: string; readonly title: string };

export class View extends Service<View>()('LoadView', { tier: 'app' }) {
  static *make() {
    return new View(yield* Readings, yield* ExecutionActs);
  }

  open = $state(false);
  aimed = $state<string | null>(null);
  private readonly endings = new SvelteMap<string, Shown>();
  private readonly busy = new SvelteMap<string, true>();

  constructor(
    private readonly readings: Readings,
    private readonly acts: ExecutionActs,
  ) {
    super();
  }

  reveal(thread: string | null): void {
    this.aimed = thread;
    this.show(true);
  }

  show(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    if (!open) {
      this.aimed = null;
      this.endings.clear();
    }
    this.readings.declare(open);
  }

  ending(key: string, now: number): Ending | null {
    const shown = this.endings.get(key);
    return shown === undefined || now - shown.at > SHOWN_MS ? null : shown;
  }

  departed(standing: ReadonlySet<string>, now: number): readonly Departed[] {
    return [...this.endings].flatMap(([key, shown]) =>
      standing.has(key) || now - shown.at > SHOWN_MS
        ? []
        : [{ key, title: shown.title, text: shown.text, hint: shown.hint, failed: shown.failed }],
    );
  }

  working(key: string): boolean {
    return this.busy.has(key);
  }

  stoppable(row: LoadRow): boolean {
    return row.work !== undefined || row.processes.some((one) => one.killable);
  }

  async stop(row: LoadRow): Promise<void> {
    await this.acting(row.key, row.title, async () => {
      const work = row.work;
      if (work === undefined || work.executions.length + work.residuals.length === 0) {
        const targets = row.processes.flatMap((one) => (one.killable ? this.target(one) : []));
        if (targets.length === 0) return { text: 'not ended', hint: 'No process of this row can be ended by this user.', failed: true };
        const ended = processEnding(await this.acts.endProcesses(targets));
        const kept = row.processes.length - targets.length;
        return kept === 0
          ? ended
          : {
              text: ended.failed ? ended.text : `${kept} left running`,
              hint: [ended.hint, `${plural(kept, 'process')} of this row cannot be signalled by this user and were left running`].join(
                '\n',
              ),
              failed: true,
            };
      }
      const left = new Set(work.residuals.map((one) => one.pid));
      const targets = row.processes.flatMap((one) => (left.has(one.pid) && one.killable ? this.target(one) : []));
      const [stops, residuals] = await Promise.all([
        Promise.all(work.executions.map((one) => this.acts.stop(one.projectId, one.key, { kind: one.kind, execution: one.execution }))),
        targets.length === 0 ? Promise.resolve(null) : this.acts.endProcesses(targets),
      ]);
      return workEnding(
        stops.filter((one) => one !== null),
        residuals === null ? null : processEnding(residuals),
      );
    });
  }

  async kill(row: LoadRow, process: LoadProcess): Promise<void> {
    await this.acting(`${row.key}/${process.pid}`, `${process.name} (pid ${process.pid})`, async () => {
      const targets = this.target(process);
      if (targets.length === 0) return { text: 'not ended', hint: 'The machine is not read yet.', failed: true };
      return processEnding(await this.acts.endProcesses(targets));
    });
  }

  private target(process: LoadProcess): readonly ProcessTarget[] {
    const scope = this.readings.view?.scope;
    return scope === undefined ? [] : [{ scope, identity: { pid: process.pid, birth: process.birth } }];
  }

  private async acting(key: string, title: string, act: () => Promise<Ending>): Promise<void> {
    if (this.busy.has(key)) return;
    this.busy.set(key, true);
    try {
      this.endings.set(key, { ...(await act()), at: Date.now(), title });
    } finally {
      this.busy.delete(key);
    }
  }
}
