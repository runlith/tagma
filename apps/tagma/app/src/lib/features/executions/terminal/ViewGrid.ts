import { ViewId } from '@tagma/server/executions/contract/wire/viewLeases';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import type { ExecutionAddress } from '../Repo.js';

const TRANSPORT = 'transport';
const REOPEN_DELAY_MS = 10_000;

export type Grid = { readonly rows: number; readonly columns: number };

type Held = { unsubscribe(): void };

const sameBox = (one: Grid | null, other: Grid | null): boolean =>
  one !== null && other !== null && one.rows === other.rows && one.columns === other.columns;

const cut = (box: Grid, ceiling: Grid | null): Grid =>
  ceiling === null ? box : { rows: Math.min(box.rows, ceiling.rows), columns: Math.min(box.columns, ceiling.columns) };

export class ViewGrid {
  private address: ExecutionAddress | null = null;
  private held: Held | null = null;
  private latest: Grid | null = null;
  private told: Grid | null = null;
  private telling = false;
  private retrying: Held | null = null;
  private readonly view: ViewId;

  constructor(
    private readonly live: LiveConnection,
    private readonly projectId: number,
    view: string,
    private readonly draw: (grid: Grid) => void,
    private readonly recorded: () => Grid | null,
    private readonly applied: (grid: Grid) => void,
    private readonly ceiling: () => Grid | null = () => null,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  ) {
    this.view = ViewId.make(view);
  }

  get box(): Grid | null {
    return this.latest;
  }

  drawn(): Grid | null {
    return this.recorded();
  }

  laid(): void {
    const grid = this.recorded();
    if (grid !== null) this.draw(grid);
  }

  follow(address: ExecutionAddress): void {
    const standing = this.address;
    const same = standing !== null && standing.execution === address.execution && standing.incarnation === address.incarnation;
    if (same && this.held !== null) return;
    this.stop();
    this.address = address;
    this.subscribe(address);
    this.laid();
  }

  stop(): void {
    this.held?.unsubscribe();
    this.held = null;
    this.address = null;
    this.told = null;
    this.retrying = null;
  }

  measured(box: Grid): void {
    this.latest = cut(box, this.ceiling());
    void this.tell();
  }

  private subscribe(address: ExecutionAddress): void {
    this.told = this.latest;
    this.retrying = null;
    const held: Held = this.live.hold(
      (client) => {
        const box = this.latest;
        this.told = box;
        this.retrying = null;
        return client['terminal.grid.subscribe']({
          projectId: this.projectId,
          execution: address.execution,
          incarnation: address.incarnation,
          view: this.view,
          box: box ?? undefined,
        });
      },
      (frame) => {
        if (this.held !== held) return;
        this.retrying = null;
        this.applied(frame.applied);
      },
      (failure) => {
        if (failure.kind !== 'subscription' || this.held !== held) return;
        this.told = null;
        this.again(held, address);
      },
      'bytes',
    );
    this.held = held;
  }

  private again(held: Held, address: ExecutionAddress): void {
    if (this.retrying === held) return;
    this.retrying = held;
    void this.wait(REOPEN_DELAY_MS).then(() => {
      if (this.retrying !== held || this.held !== held || this.address !== address) return;
      this.retrying = null;
      held.unsubscribe();
      this.subscribe(address);
    });
  }

  private async tell(): Promise<void> {
    const address = this.address;
    const box = this.latest;
    if (this.telling || address === null || this.held === null || box === null || sameBox(box, this.told)) return;
    this.telling = true;
    let heard = false;
    try {
      await this.live.call((client) =>
        client['terminal.grid.report']({
          projectId: this.projectId,
          execution: address.execution,
          incarnation: address.incarnation,
          view: this.view,
          box,
        }),
      );
      heard = this.address === address;
      if (heard) this.told = box;
    } catch (error) {
      const held = this.held;
      if (held !== null && this.address === address && refusalOf(error).code !== TRANSPORT) {
        held.unsubscribe();
        this.subscribe(address);
      }
    } finally {
      this.telling = false;
    }
    if (heard && !sameBox(this.latest, this.told)) void this.tell();
  }
}
