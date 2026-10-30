import { Data, Schema } from 'effect';
import { PROJECT_KINDS, STORAGE_MODES } from '../../../projects/contract/wire/project.js';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';

export const RegistryFile = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      repoKey: Schema.String,
      rootPath: Schema.String,
      storage: Schema.Literals([...STORAGE_MODES, 'plain']),
      createdAt: Schema.String,
      strictProvenance: Schema.optional(Schema.Boolean),
      private: Schema.optional(Schema.Boolean),
      kind: Schema.optional(Schema.Literals(PROJECT_KINDS)),
      global: Schema.optional(Schema.Boolean),
      removedAt: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  settings: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      scope: Schema.Literals(SETTABLE_SCOPES),
      key: Schema.String,
      projectId: Schema.NullOr(Schema.Number),
      value: Schema.NullOr(Schema.String),
      declined: Schema.optional(Schema.Boolean),
      updatedAt: Schema.String,
    }),
  ),
});
export type RegistryFile = typeof RegistryFile.Type;

export class RegistryUnreadable extends Data.TaggedError('RegistryUnreadable')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.path} is not a readable machine registry (${this.reason}); fix or remove it, and start again`;
  }
}
