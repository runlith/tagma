import type { AgentDeclared } from '@runlith/agent/thread/agents/AgentDefinitions';

export type AgentDeclaration = AgentDeclared & {
  readonly name: string;
  readonly description: string;
  readonly runPolicy?: {
    readonly userStartable: boolean;
    readonly backgroundStartable: boolean;
  };
};
