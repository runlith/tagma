import { pageCeiling, pageLimit, type PageFamily } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';

export const ceilingOf = (of: PageFamily): number => pageCeiling(of, TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES);

export const limitOf = (of: PageFamily): ReturnType<typeof pageLimit> => pageLimit(of, ceilingOf(of));
