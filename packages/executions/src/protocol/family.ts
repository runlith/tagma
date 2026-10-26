import { Schema } from 'effect';

export const ProtocolFamily = Schema.Literal('executions/1');
export type ProtocolFamily = typeof ProtocolFamily.Type;
