import { Schema } from 'effect';
import { ProcessWitness } from '@runlith/executions/protocol/evidence';

export const processChainSchema = Schema.Struct({ id: Schema.String, path: Schema.String });
export type ProcessChain = typeof processChainSchema.Type;

export const processChainRecordSchema = Schema.Struct({
  id: Schema.String,
  stopping: Schema.Boolean,
  cli: Schema.NullOr(Schema.String),
  members: Schema.Array(Schema.Struct({ ...ProcessWitness.fields, admitted: Schema.Boolean })),
});
export type ProcessChainRecord = typeof processChainRecordSchema.Type;

export const PROCESS_CHAIN = 'TAGMA_PROCESS_CHAIN';
export const PROCESS_RECORD = 'process.json';
