import { Schema } from 'effect';
import { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { harnessNameSchema } from '@runlith/tagma/adapter/harness';
import { HARNESS_HOOK_BYTES } from '../../../threads/contract/wire/harness/observation.js';
import { HARNESS_ID_MAX } from '@runlith/tagma/adapter/harness';
import { HARNESS_STORAGE_LIMIT, harnessStorageEntrySchema } from '../../../threads/contract/wire/harness/session.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const ANCESTRY_LIMIT = 16;

export const SETTLED_ADOPTION_REFUSALS: readonly string[] = ['shell-unknown', 'not-under-shell', 'harness-unhooked'];

export const adoptionKeptName = (key: string): string => `tagma-adopt-${key.replace(/[^\w.-]/g, '')}.json`;

const word = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HARNESS_ID_MAX));

export const harnessAdoptSchema = Schema.Struct({
  shell: word,
  harness: harnessNameSchema,
  key: word,
  ancestry: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))).check(Schema.isMinLength(1), Schema.isMaxLength(ANCESTRY_LIMIT)),
  machine: word,
  cwd: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HARNESS_HOOK_BYTES)).annotate(placeRole('value'))),
  storage: Schema.Array(harnessStorageEntrySchema).check(Schema.isMaxLength(HARNESS_STORAGE_LIMIT)),
});
export type HarnessAdoptInput = typeof harnessAdoptSchema.Type;

export const harnessAdoptedSchema = Schema.Struct({
  threadId: Schema.String,
  grant: Schema.String,
  session: Schema.String,
  job: ProcessWitness,
});
export type HarnessAdopted = typeof harnessAdoptedSchema.Type;
