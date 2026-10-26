import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { EnvironmentVerdictFailure } from '../contract/wire/environments.js';
import type { EnvironmentRecordUnreadable } from '../store/environments.js';
import type { EnvironmentUseUnreadable } from '../store/environmentUses.js';

export type EnvironmentFailure = EnvironmentVerdictFailure | StoreFailure | EnvironmentRecordUnreadable | EnvironmentUseUnreadable;

export function environmentVerdictOf(error: EnvironmentFailure): EnvironmentVerdictFailure {
  switch (error._tag) {
    case 'SqlError':
    case 'EffectDrizzleQueryError':
    case 'EnvironmentRecordUnreadable':
    case 'EnvironmentUseUnreadable':
      return { _tag: 'EnvironmentRegistryUnavailable', reason: error.message };
    default:
      return error;
  }
}
