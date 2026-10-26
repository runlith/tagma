import { Context, Data } from 'effect';
import type { StoreIdentity } from '../contract/service/store.js';

export type UnitLife = { readonly identity: StoreIdentity; readonly operation: string; open: boolean };

export const UnitLife = Context.Reference<UnitLife | null>('tagma/platform/UnitLife', { defaultValue: () => null });

export class LateStatementRefused extends Data.TaggedError('LateStatementRefused')<{ readonly store: string; readonly operation: string }> {
  override get message(): string {
    return `${this.store}: a statement ran for the ${this.operation} unit after it ended, from a fiber that outlived it`;
  }
}
