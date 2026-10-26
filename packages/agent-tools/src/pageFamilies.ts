import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { Schema } from 'effect';
import { family, pageCeiling, pageLimit, type PageFamily } from '@runlith/paging';

export const GLOB = family('glob', 1, 'text', { text: 100, json: 111 }, 100, () => `/workspace/${'x'.repeat(60)}/${'y'.repeat(20)}.ts`);

export const GREP_FILES = family('grep-files', 1, 'text', { text: 70, json: 81 }, 100, () => `${'x'.repeat(55)}/${'y'.repeat(12)}.ts`);

export const GREP_COUNTS = family('grep-counts', 1, 'text', { text: 74, json: 85 }, 100, () => `${'x'.repeat(55)}/${'y'.repeat(12)}.ts:12`);

export const GREP_LINES = family('grep-lines', 1, 'text', { text: 161, json: 181 }, 250, () => `${'x'.repeat(55)}:42:${'x'.repeat(100)}`);

export const LISTING = family('listing', 1, 'text', { text: 35, json: 46 }, 100, () => `${'x'.repeat(30)}.ts`);

export const ceilingOf = (of: PageFamily): number => pageCeiling(of, TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES);

export const limitOf = (of: PageFamily): ReturnType<typeof pageLimit> => pageLimit(of, ceilingOf(of));

export const LS_WALK = {
  operation: 'ls',
  order: LISTING.order,
  selection: Schema.Struct({ path: Schema.String }),
  key: Schema.Tuple([Schema.String]),
};

export const GLOB_WALK = {
  operation: 'glob',
  order: GLOB.order,
  selection: Schema.Struct({ pattern: Schema.String, path: Schema.String }),
  key: Schema.Tuple([Schema.Number, Schema.String]),
};
