import { family } from '@runlith/paging';
import type { ServedInstance } from './catalog.js';

const bytesOf = (row: unknown): number => new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;

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

export const INSTANCE_ROWS = family(
  'adapter-instances',
  1,
  'json',
  { text: bytesOf(wideInstance()), json: bytesOf(wideInstance()) },
  'ceiling',
  wideInstance,
);
