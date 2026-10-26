import { Schema } from 'effect';

export const Credential = Schema.Struct({ apiKey: Schema.String });
export type Credential = typeof Credential.Type;
