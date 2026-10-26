import type { BaseQuery } from '@runlith/query/types';
import type { Page } from '$lib/features/palette/Repo.js';

export type Asked<Row, Extra, Aim> = (text: string, aim: Aim, cursor: string | null) => BaseQuery<Page<Row, Extra>>;

export class Feed<Row, Extra, Aim> {
  rows = $state.raw<readonly Row[]>([]);
  total = $state<number | null>(null);
  atLeast = $state<number | null>(null);
  next = $state<string | null>(null);
  approximate = $state(false);
  extra = $state.raw<Extra | null>(null);
  loading = $state(false);
  failure = $state.raw<unknown>(null);

  private text = '';
  private aim: Aim | null = null;
  private turn = 0;
  private pending: BaseQuery<Page<Row, Extra>> | null = null;

  constructor(private readonly asked: Asked<Row, Extra, Aim>) {}

  ask(text: string, aim: Aim): void {
    const turn = this.supersede();
    this.text = text;
    this.aim = aim;
    this.failure = null;
    this.load(
      turn,
      null,
      (page) => {
        this.rows = page.rows;
      },
      () => {
        this.rows = [];
        this.total = null;
        this.atLeast = null;
        this.next = null;
        this.approximate = false;
        this.extra = null;
      },
    );
  }

  more(): void {
    const cursor = this.next;
    if (cursor === null || this.loading) return;
    this.load(this.turn, cursor, (page) => {
      this.rows = [...this.rows, ...page.rows];
    });
  }

  clear(): void {
    this.supersede();
    this.aim = null;
    this.rows = [];
    this.total = null;
    this.atLeast = null;
    this.next = null;
    this.approximate = false;
    this.extra = null;
    this.failure = null;
    this.loading = false;
  }

  private load(turn: number, cursor: string | null, place: (page: Page<Row, Extra>) => void, drop: () => void = () => undefined): void {
    if (this.aim === null) return;
    this.loading = true;
    const pending = this.asked(this.text, this.aim, cursor);
    this.pending = pending;
    void pending
      .loadOrThrow()
      .then((page) => {
        if (turn !== this.turn || page === undefined) return;
        place(page);
        this.total = page.total;
        this.atLeast = page.atLeast;
        this.next = page.next;
        this.approximate = page.approximate;
        this.extra = page.extra;
      })
      .catch((error: unknown) => {
        if (turn !== this.turn) return;
        drop();
        this.failure = error;
      })
      .finally(() => {
        if (turn === this.turn) this.loading = false;
      });
  }

  private supersede(): number {
    this.turn += 1;
    void this.pending?.cancel();
    this.pending = null;
    return this.turn;
  }
}
