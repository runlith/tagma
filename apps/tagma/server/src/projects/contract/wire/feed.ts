import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';

export const registryRevisionSchema = Schema.Struct({ revision: Schema.Int });
export type RegistryRevision = typeof registryRevisionSchema.Type;

export const PROJECTS_FEED = feed('projects.subscribe', {
  input: Schema.Struct({}),
  event: registryRevisionSchema,
  refusals: [],
  callers: 'operator',
});
