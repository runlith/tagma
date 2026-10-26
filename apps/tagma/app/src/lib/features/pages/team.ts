import { Service } from '@runlith/layer/key';

export type PageTeam = {
  readonly ids: readonly string[];
  readonly names: ReadonlyMap<string, string>;
};

export interface TeamPort {
  of(threadId: string): PageTeam;
}

export class PageTeams extends Service<TeamPort>()('PageTeams', { tier: 'project' }) {}
