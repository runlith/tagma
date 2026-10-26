import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { sessionIdentitySchema } from '../../../platform/contract/wire/session.js';
import { installationCutSchema, sourceSchema } from '../../../installation/contract/wire/source.js';
import { frozenStateSchema } from '../../../installation/contract/wire/builds.js';
import { startupStateSchema } from '../../../installation/contract/wire/restart.js';

export const stalledSchema = Schema.Struct({
  pid: Schema.Int,
  database: Schema.String,
  heldFor: Schema.NullOr(Schema.String),
  heldMs: Schema.Number,
  quietMs: Schema.Number,
  waiting: Schema.Int,
});

export const healthSchema = Schema.Struct({
  ok: Schema.Literal(true),
  version: Schema.String,
  database: Schema.String,
  schema: Schema.Struct({ applied: Schema.Number, latest: Schema.NullOr(Schema.String) }),
  source: sourceSchema,
  builds: frozenStateSchema,
  standing: Schema.NullOr(installationCutSchema),
  sessionIdentity: sessionIdentitySchema,
  artifactOrigin: Schema.String,
  sandboxOrigin: Schema.NullOr(Schema.String),
  stalled: Schema.NullOr(stalledSchema),
});

export const unreadyHealthSchema = Schema.Struct({ ok: Schema.Literal(false), ...startupStateSchema.fields });

export const HealthGroup = HttpApiGroup.make('health')
  .add(HttpApiEndpoint.get('health', '/health', { success: healthSchema }))
  .add(HttpApiEndpoint.get('startup', '/startup', { success: startupStateSchema }));
