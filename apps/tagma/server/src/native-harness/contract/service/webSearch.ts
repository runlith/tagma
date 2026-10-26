import { Context } from 'effect';
import type { WebSearchSessions } from '@runlith/agent-tools/WebSearchSessions';

export class WebSearch extends Context.Service<WebSearch, WebSearchSessions>()('tagma/native-harness/WebSearch') {}
