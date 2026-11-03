import { Schema } from 'effect';
import { Digest } from '@runlith/executions/protocol/artifact';
import { InstallationManifest } from './manifest.js';

export const ProofAsk = Schema.Union([
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Decode'), root: Schema.String, text: Schema.String }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Begin') }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Chunk'), session: Schema.Int, bytes: Schema.Uint8Array }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('End'), session: Schema.Int }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Drop'), session: Schema.Int }),
]);
export type ProofAsk = typeof ProofAsk.Type;

export const ProofAnswer = Schema.Union([
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Decoded'), manifest: InstallationManifest }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Rejected'), detail: Schema.String }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Begun'), session: Schema.Int }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Updated') }),
  Schema.Struct({ id: Schema.Int, _tag: Schema.Literal('Hashed'), bytes: Schema.Int, digest: Digest }),
]);
export type ProofAnswer = typeof ProofAnswer.Type;
