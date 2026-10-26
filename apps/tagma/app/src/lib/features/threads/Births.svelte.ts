import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { forkThreadName } from '@tagma/server/thread-record/contract/wire/name';

export type BirthAim = {
  readonly name: string;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly root: string | null;
};

export type ForkSource = {
  readonly id: string;
  readonly projectId: number;
  readonly title: string;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
};

type Birth = BirthAim & {
  readonly key: string;
  readonly at: string;
  readonly projectId: number;
  readonly source: string | null;
  readonly threadId: string | null;
  readonly runId: string | null;
  readonly settled: boolean;
};

function idOf(birth: Birth): string {
  return birth.threadId ?? birth.key;
}

export class Births {
  private standing = $state.raw<readonly Birth[]>([]);
  private readonly unbornRows = new WeakMap<Birth, ThreadListRow>();

  constructor(
    private readonly projectId: number,
    private readonly base: (threadId: string) => ThreadListRow | undefined,
    private readonly born: (threadId: string) => void,
    private readonly repaint: (threadIds: readonly string[]) => void,
  ) {}

  draw(id: string, base: ThreadListRow | undefined): ThreadListRow | undefined {
    const birth = this.standing.find((candidate) => idOf(candidate) === id);
    if (birth === undefined) return base;
    return base === undefined ? this.unbornRow(birth) : base;
  }

  private stand(next: readonly Birth[]): void {
    const before = this.standing;
    this.standing = next;
    const touched = new Set<string>();
    for (const birth of before) if (!next.includes(birth)) touched.add(idOf(birth));
    for (const birth of next) if (!before.includes(birth)) touched.add(idOf(birth));
    if (touched.size > 0) this.repaint([...touched]);
  }

  private conceive(aim: BirthAim, projectId: number, source: string | null): Birth {
    const birth: Birth = {
      ...aim,
      key: `birth:${crypto.randomUUID()}`,
      at: new Date().toISOString(),
      projectId,
      source,
      threadId: null,
      runId: null,
      settled: false,
    };
    this.stand([...this.standing, birth]);
    return birth;
  }

  async bear(aim: BirthAim, create: () => Promise<string | null>): Promise<string | null> {
    const birth = this.conceive(aim, this.projectId, null);
    let threadId: string | null = null;
    try {
      threadId = await create();
      if (threadId !== null) this.born(threadId);
      return threadId;
    } finally {
      this.replace(birth.key, (standing) => (threadId === null ? { ...standing, settled: true } : { ...standing, threadId }));
    }
  }

  async fork<Answer extends { readonly threadId: string }>(
    source: ForkSource,
    branch: () => Promise<Answer | null>,
  ): Promise<Answer | null> {
    const aim = {
      name: forkThreadName(source.title),
      agentId: source.agentId,
      provider: source.provider,
      model: source.model,
      reasoning: source.reasoning,
      root: null,
    };
    const birth = this.conceive(aim, source.projectId, source.id);
    let threadId: string | null = null;
    try {
      const answer = await branch();
      threadId = answer?.threadId ?? null;
      return answer;
    } finally {
      const listed = source.projectId === this.projectId && this.listed(source.id) !== undefined ? threadId : null;
      this.replace(birth.key, (standing) => ({ ...standing, threadId: listed, settled: true }));
    }
  }

  settle(threadId: string, runId: string | null): void {
    this.stand(this.standing.map((birth) => (birth.threadId === threadId ? { ...birth, runId, settled: true } : birth)));
    this.land(false);
  }

  forget(threadId: string): void {
    if (this.standing.some((birth) => birth.threadId === threadId)) {
      this.stand(this.standing.filter((birth) => birth.threadId !== threadId));
    }
  }

  land(authoritative: boolean): void {
    if (this.standing.length === 0) return;
    const kept = this.standing.filter((birth) => {
      if (birth.threadId === null) return !birth.settled;
      const row = this.base(birth.threadId);
      if (row === undefined) return !(authoritative && birth.settled);
      if (row.activeRunId !== null || row.life !== 'idle') return false;
      if (birth.runId !== null) return row.outcome?.runId !== birth.runId;
      return !birth.settled;
    });
    if (kept.length !== this.standing.length) this.stand(kept);
  }

  listed(threadId: string): ThreadListRow | undefined {
    return this.base(threadId);
  }

  unborn(id: string): boolean {
    return this.standing.some((birth) => birth.threadId === null && birth.key === id);
  }

  aimOf(id: string): string | null {
    return this.standing.find((birth) => (birth.threadId ?? birth.key) === id)?.root ?? null;
  }

  sourceOf(id: string): string | null {
    return this.standing.find((birth) => (birth.threadId ?? birth.key) === id)?.source ?? null;
  }

  private replace(key: string, next: (birth: Birth) => Birth): void {
    this.stand(this.standing.map((birth) => (birth.key === key ? next(birth) : birth)));
    this.land(false);
  }

  private unbornRow(birth: Birth): ThreadListRow {
    const remembered = this.unbornRows.get(birth);
    if (remembered !== undefined) return remembered;
    const id = birth.threadId ?? birth.key;
    const drawn: ThreadListRow = {
      id,
      projectId: birth.projectId,
      scopeName: null,
      title: birth.name,
      titleOrigin: 'random',
      life: 'idle',
      activeRunId: null,
      activeRunStartedAt: null,
      activeRunSelection: null,
      contextShare: null,
      cacheWarmth: null,
      liveSpellStartedAt: null,
      outcome: null,
      spawnRootId: id,
      parentThreadId: null,
      name: birth.name,
      agentId: birth.agentId,
      profileId: null,
      harness: null,
      cli: null,
      capabilities: NATIVE_CAPABILITIES,
      phase: null,
      held: { paths: 0, unproven: 0 },
      account: null,
      provider: birth.provider,
      model: birth.model,
      reasoning: birth.reasoning,
      switches: {},
      createdBySessionId: null,
      readerOrderAt: birth.at,
      pinnedAt: null,
      archivedAt: null,
      createdAt: birth.at,
      updatedAt: birth.at,
    };
    this.unbornRows.set(birth, drawn);
    return drawn;
  }
}
