import { family } from '@runlith/paging';
import { Schema } from 'effect';
import { adapterStateSchema, type ServedInstance } from './catalog.js';

export const adapterRowSchema = Schema.Struct({
  adapter: adapterStateSchema,
  settings: Schema.NullOr(Schema.Struct({ title: Schema.String, instances: Schema.Int })),
});
export type AdapterRow = typeof adapterRowSchema.Type;

const bytesOf = (row: unknown): number => new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;

const wideAdapter = (): AdapterRow => ({
  adapter: {
    id: 'x'.repeat(60),
    origin: 'plugin',
    version: 'x'.repeat(20),
    state: 'failed',
    reason: 'x'.repeat(600),
  },
  settings: { title: 'x'.repeat(60), instances: 1000 },
});

const wideInstance = (): ServedInstance => ({
  id: 'x'.repeat(80),
  revision: 'x'.repeat(40),
  values: {
    name: 'x'.repeat(60),
    baseUrl: `https://${'x'.repeat(120)}`,
    reasoningField: 'x'.repeat(30),
    reasoningMapping: 'x'.repeat(80),
    reasoningEcho: true,
    models: Array.from({ length: 20 }, () => ({
      id: 'x'.repeat(60),
      label: 'x'.repeat(60),
      context: 1_000_000,
      output: 128_000,
      vision: true,
      toolChoice: ['auto', 'required', 'none'],
      reasoning: ['low', 'medium', 'high'],
      defaultReasoning: 'medium',
      reasoningField: 'x'.repeat(30),
      reasoningMapping: 'x'.repeat(60),
    })),
  },
});

export const ADAPTER_ROWS = family(
  'adapters',
  1,
  'json',
  { text: bytesOf(wideAdapter()), json: bytesOf(wideAdapter()) },
  'ceiling',
  wideAdapter,
);

export const INSTANCE_ROWS = family(
  'adapter-instances',
  1,
  'json',
  { text: bytesOf(wideInstance()), json: bytesOf(wideInstance()) },
  'ceiling',
  wideInstance,
);
