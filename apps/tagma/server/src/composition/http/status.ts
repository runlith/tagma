import type { Context } from 'effect';
import type { World } from '@runlith/agent-tools/world';
import type { SchemaState } from '../../platform/contract/service/store.js';
import type { Source } from '../../installation/contract/wire/source.js';
import type { ConsoleKeyRollback, DowngradeSteps } from '../../installation/contract/service/steps.js';
import type { Measurement } from '../../performance/contract/service/measurement.js';
import type { JudgingServices } from '../../enforcement/serving.js';
import type { OperationChecks } from '../../invocation/contract/service/operationChecks.js';

export type RuntimeStatus = {
  readonly version: string;
  readonly database: string;
  readonly schema: SchemaState;
  readonly source: Source;
  readonly artifactOrigin: string;
  readonly sandboxOrigin: string | null;
};

export type ServedEnforcement = Context.Context<JudgingServices | OperationChecks>;

export type ServedMeasurement = Measurement;

export type ServedMachineWorld = World;

export type ServedSteps = Context.Context<ConsoleKeyRollback | DowngradeSteps>;
