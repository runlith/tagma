import { getTableName, type Table } from 'drizzle-orm';
import { Effect } from 'effect';
import { UnitOpen } from './transaction.js';

export class TableMoves {
  private undeclared = 0;
  private shifts = 0;
  private readonly moved = new Map<string, number>();

  readonly committed = (tables: ReadonlySet<string> | null): void => {
    this.shifts += 1;
    if (tables === null) {
      this.undeclared += 1;
      return;
    }
    for (const table of tables) this.moved.set(table, (this.moved.get(table) ?? 0) + 1);
  };

  readonly revision = (tables: readonly string[]): number => {
    let revision = this.undeclared;
    for (const table of tables) revision += this.moved.get(table) ?? 0;
    return revision;
  };

  readonly total = (): number => this.shifts;

  readonly answers = <K, A>(tables: readonly Table[]): TableAnswers<K, A> =>
    new TableAnswers(
      this,
      tables.map((table) => getTableName(table).toLowerCase()),
    );
}

export class TableAnswers<K, A> {
  private readonly held = new Map<K, A>();
  private at = -1;

  constructor(
    private readonly moves: TableMoves,
    private readonly tables: readonly string[],
  ) {}

  readonly read = <E, R>(key: K, read: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(UnitOpen, (open) => {
      if (open) return read;
      const revision = this.moves.revision(this.tables);
      if (revision !== this.at) {
        this.held.clear();
        this.at = revision;
      }
      if (this.held.has(key)) return Effect.succeed(this.held.get(key) as A);
      return Effect.tap(read, (answer) =>
        Effect.sync(() => {
          if (this.at === revision && this.moves.revision(this.tables) === revision) this.held.set(key, answer);
        }),
      );
    });
}
