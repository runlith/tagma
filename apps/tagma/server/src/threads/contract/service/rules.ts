import type { AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { Context } from 'effect';

export type RuledThread = { readonly projectId: number; readonly thread: { readonly id: string } };

export class AgentRules extends Context.Service<AgentRules, { readonly rules: readonly AgentRule<RuledThread>[] }>()(
  'threads/AgentRules',
) {}
