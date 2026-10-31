import type { ReturnedRows, SqliteProgram } from '@runlith/sqlite-process/channel';
import { Context, Data, type Effect } from 'effect';
import type { StoreIdentity } from '../contract/service/store.js';
import type { WriteSet } from '../contract/service/writes.js';

export type UnitLife = { readonly identity: StoreIdentity; readonly operation: string; open: boolean };

export const UnitLife = Context.Reference<UnitLife | null>('tagma/platform/UnitLife', { defaultValue: () => null });

export type Returning = { rows: ReturnedRows | null };

export type Building = {
  readonly store: StoreIdentity;
  readonly statements: (SqliteProgram['statements'][number] & { readonly set: WriteSet })[];
  readonly tails: Effect.Effect<void>[];
  readonly sets: WriteSet[];
  readonly returning: Returning[];
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
