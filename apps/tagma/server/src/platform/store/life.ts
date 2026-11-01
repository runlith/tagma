import type { ReturnedRows, SqliteProgram } from '@runlith/sqlite-process/channel';
import { Context, Data, type Effect } from 'effect';
import type { StoreIdentity } from '../contract/service/store.js';
import type { WriteSet } from '../contract/service/writes.js';

export type UnitLife = { readonly identity: StoreIdentity; readonly operation: string; open: boolean };

export const UnitLife = Context.Reference<UnitLife | null>('tagma/platform/UnitLife', { defaultValue: () => null });

const ends = new WeakMap<object, UnitEnd>();

export class UnitEnd {
  private readonly releases: (() => void)[] = [];
  private closed = false;

  static of(unit: object): UnitEnd | undefined {
    return ends.get(unit);
  }

  bind<U extends object>(unit: U): U {
    ends.set(unit, this);
    return unit;
  }

  release(release: () => void): void {
    if (this.closed) release();
    else this.releases.push(release);
  }

  close(): void {
    this.closed = true;
    for (const release of this.releases.splice(0)) release();
  }
}

export const atUnitEnd = (unit: object, release: () => void): void => {
  ends.get(unit)?.release(release);
};

export type Returning = { rows: ReturnedRows | null };

export type Building = {
  readonly store: StoreIdentity;
  readonly statements: (SqliteProgram['statements'][number] & { readonly set: WriteSet })[];
  readonly tails: Effect.Effect<void>[];
  readonly sets: WriteSet[];
  readonly returning: Returning[];
  readonly end: UnitEnd;
};

export const ProgramOpen = Context.Reference<Building | null>('tagma/platform/ProgramOpen', { defaultValue: () => null });

export class UnitInProgramRefused extends Data.TaggedError('UnitInProgramRefused')<{ readonly store: string; readonly operation: string }> {
  override get message(): string {
    return `${this.store}: the ${this.operation} unit opened while a program for this store was being built; a program's work holds no writer, so it writes through its program unit`;
  }
}

export class LateStatementRefused extends Data.TaggedError('LateStatementRefused')<{ readonly store: string; readonly operation: string }> {
  override get message(): string {
    return `${this.store}: a statement ran for the ${this.operation} unit after it ended, from a fiber that outlived it`;
  }
}
