import { Context } from 'effect';
import type { AgentRegistry } from './AgentRegistry';

export class ThreadAgents extends Context.Service<ThreadAgents, AgentRegistry>()('@runlith/agent/ThreadAgents') {}
