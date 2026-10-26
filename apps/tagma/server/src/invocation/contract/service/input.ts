import { Effect, Schema, type SchemaAST } from 'effect';
import { jsonCodec } from '@runlith/utils/codec';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

const ISSUE_LINE_CHARS = 600;

const issueLines = (message: string): string =>
  message
    .split('\n')
    .map((line) => (line.length > ISSUE_LINE_CHARS ? `${line.slice(0, ISSUE_LINE_CHARS)}…` : line))
    .join('\n');

export const inputRefusal = (error: Schema.SchemaError): GateRefusal<'body-shape'> =>
  new GateRefusal('body-shape', issueLines(error.message), ['the reason names the field: send that one in the shape it asks for']);

export const inputParsing: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all', reportInput: true };

export const inputDecoder = <A>(schema: Schema.Codec<A, unknown>) => {
  const decode = Schema.decodeUnknownEffect(jsonCodec(schema));
  return (input: unknown) => decode(input, inputParsing).pipe(Effect.mapError(inputRefusal));
};
