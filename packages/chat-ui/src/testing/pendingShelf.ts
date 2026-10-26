import { Effect } from 'effect';
import type { KeptTurn, PendingShelf } from '../session/PendingTurns';

export class MemoryShelf implements PendingShelf {
  readonly turns = new Map<string, KeptTurn>();
  readonly handedBack: KeptTurn[] = [];

  kept(): readonly KeptTurn[] {
    return [...this.turns.values()];
  }

  keep(turn: KeptTurn): void {
    this.turns.set(turn.inputId, turn);
  }

  drop(inputId: string): void {
    this.turns.delete(inputId);
  }

  orphans(): Effect.Effect<readonly KeptTurn[]> {
    return Effect.sync(() => this.kept());
  }

  handBack(turn: KeptTurn): void {
    this.handedBack.push(turn);
  }
}
