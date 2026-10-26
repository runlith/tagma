import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import { ThreadTeam } from '../team/ThreadTeam.svelte.js';
import type { TeamView } from '../team/view.js';
import type { AuthorityView } from './authority.js';
import type { ModelView } from './modelSettings.js';
import { ThreadAuthority } from './ThreadAuthority.svelte.js';
import { ThreadSettings } from './ThreadSettings.svelte.js';

export class ThreadViews {
  constructor(
    private readonly shown: ShownThread,
    private readonly birth: ThreadBirth,
  ) {}

  get model(): ModelView {
    return this.shown.lease?.get(ThreadSettings) ?? this.birth.settings;
  }

  get authority(): AuthorityView {
    return this.shown.lease?.get(ThreadAuthority) ?? this.birth.authority;
  }

  get team(): TeamView | null {
    const lease = this.shown.lease;
    return lease === null ? this.birth.team : (lease.find(ThreadTeam) ?? null);
  }
}
