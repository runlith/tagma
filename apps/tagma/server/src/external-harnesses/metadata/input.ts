import type { MetadataSession } from '@runlith/tagma/adapter/metadata';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessStorage } from '../../threads/contract/wire/harness/session.js';

export type MetadataInput = MetadataSession & {
  readonly execution: HarnessExecutionRef;
  readonly storage: HarnessStorage;
};
