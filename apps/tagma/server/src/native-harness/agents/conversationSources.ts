import { TOOL_SEARCH_TOOL } from '@runlith/agent/AgentDeferredTools';
import { OUTPUT_SOURCE } from '@runlith/agent/thread/agents/supply';
import { USER_QUESTION_SOURCE } from '@runlith/agent/tools/UserQuestion';

export const conversationSources: readonly string[] = [USER_QUESTION_SOURCE, OUTPUT_SOURCE, TOOL_SEARCH_TOOL];
