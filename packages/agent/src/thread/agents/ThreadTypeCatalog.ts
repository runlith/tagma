export type ThreadSpawnType = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly baseAgentId: string;
};

export type ThreadTypeCaller = 'operator' | 'agent';
