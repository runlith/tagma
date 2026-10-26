import { untrack } from 'svelte';
import type { ThreadPage } from '@tagma/server/artifacts/contract/wire/artifacts';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { type PageTeam, PageTeams, type TeamPort } from './team.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';

export class ThreadPages extends Service<ThreadPages>()('ThreadPages', { tier: 'thread' }) {
  static *make() {
    return new ThreadPages(
      yield* Live,
      yield* ProjectRung.Current,
      (yield* ThreadRung.Current).id,
      yield* PageTeams,
      yield* Scope,
      yield* Failure,
    );
  }

  pages = $state.raw<readonly ThreadPage[]>([]);
  total = $state(0);
  private seenAt = $state<string | null>(null);
  private held: { unsubscribe: () => void } | null = null;
  private team = '';

  constructor(
    private readonly live: LiveConnection,
    private readonly aim: ProjectAim,
    private readonly threadId: string,
    private readonly teams: TeamPort,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    const stop = $effect.root(() => {
      $effect(() => {
        const ids = this.members.ids;
        untrack(() => this.follow(ids));
      });
    });
    scope.defer(() => {
      stop();
      this.held?.unsubscribe();
    });
  }

  members = $derived.by<PageTeam>(() => this.teams.of(this.threadId));

  fresh = $derived.by<ReadonlySet<string>>(() => {
    const seen = this.seenAt;
    if (seen === null) return new Set();
    return new Set(this.pages.filter((page) => page.artifact.publishedAt > seen).map((page) => page.artifact.id));
  });

  private follow(threads: readonly string[]): void {
    const team = threads.join(' ');
    if (team === this.team) return;
    this.team = team;
    this.held?.unsubscribe();
    this.held = this.live.hold(
      (client) => client['artifacts.thread']({ projectId: this.aim.projectId, threads }),
      (frame) => {
        this.seenAt ??= newest(frame.pages);
        this.pages = frame.pages;
        this.total = frame.total;
      },
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.failure.report(
          reason.code === undefined
            ? new Error(reason.message)
            : refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }),
        );
      },
    );
  }

  seen(): void {
    this.seenAt = newest(this.pages);
  }
}

function newest(pages: readonly ThreadPage[]): string {
  return pages[0]?.artifact.publishedAt ?? '';
}
