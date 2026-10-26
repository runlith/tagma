import { Schema } from 'effect';
import { restartStateSchema } from './restart.js';
import { installationCutSchema } from './source.js';
import { machineActSchema, nextFrameSchema } from './next.js';
import { processProvenanceSchema } from '../../../platform/contract/wire/provenance.js';

export const runningExecutionSchema = Schema.Struct({
  execution: Schema.String,
  incarnation: Schema.Int,
  title: Schema.String,
  kind: Schema.Literals(['terminal', 'command']),
  holder: Schema.String,
  since: Schema.NullOr(Schema.String),
});
export type RunningExecution = typeof runningExecutionSchema.Type;

export const hostHoldingsSchema = Schema.Struct({
  running: Schema.Array(runningExecutionSchema),
  terminals: Schema.Int,
  commands: Schema.Int,
  records: Schema.Int,
});

export const serverStateSchema = Schema.Struct({
  pid: Schema.Int,
  startedAt: Schema.String,
  agents: Schema.Int,
  calls: Schema.Int,
  born: Schema.Struct({
    replacedPid: Schema.NullOr(Schema.Int),
  }),
  installation: Schema.NullOr(installationCutSchema),
  cut: Schema.NullOr(processProvenanceSchema),
  waiting: Schema.NullOr(installationCutSchema),
  next: nextFrameSchema,
});

export const hostStateSchema = Schema.Struct({
  presence: Schema.Literals(['answering', 'unspoken', 'absent']),
  detail: Schema.String,
  incarnation: Schema.NullOr(Schema.Int),
  build: Schema.NullOr(Schema.String),
  since: Schema.NullOr(Schema.String),
  custody: Schema.Literals(['ours', 'other', 'vacant', 'unknown']),
  holds: Schema.NullOr(hostHoldingsSchema),
  memory: Schema.NullOr(Schema.Struct({ reserved: Schema.Int, retained: Schema.Int, grant: Schema.Int })),
});

export const machineStateSchema = Schema.Struct({
  readAt: Schema.String,
  server: serverStateSchema,
  host: hostStateSchema,
  acts: Schema.Array(machineActSchema),
  restart: restartStateSchema,
});
export type MachineState = typeof machineStateSchema.Type;
