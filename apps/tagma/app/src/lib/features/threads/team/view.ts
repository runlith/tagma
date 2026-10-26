import type { ReviewPolicy, TeamEdit, TeamLayer } from '@runlith/agent/collaboration/team';
import type { TeamRead } from './TeamRepo.js';

export interface TeamView {
  readonly read: TeamRead | undefined;
  readonly layer: TeamLayer | null;
  readonly differs: boolean;
  readonly busy: boolean;
  refresh(): void;
  edit(edit: TeamEdit): Promise<void>;
  review(review: ReviewPolicy): Promise<void>;
  reset(): Promise<void>;
  promote(): Promise<void>;
}
