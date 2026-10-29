import {
  type DomainBlock,
  type DomainPolicy,
  domainBlock,
  type Restriction,
  type RestrictionState,
} from '@tagma/server/browser/contract/wire/domains';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';

export type GateFailure = { readonly block: DomainBlock; seen: boolean };

export type NavigationGate = {
  policy: DomainPolicy;
  source: Restrictions;
  watch: number | null;
  pending: GateFailure | null;
  failure: GateFailure | null;
};

export type NavigationAdmission = { readonly gate: NavigationGate | null; readonly changes: readonly Restriction[] };

export type RestrictedPage = {
  readonly id: () => PageId | null;
  readonly revision: () => number;
  readonly navigation: (active: boolean) => void;
  readonly blocked: (watch: number, block: DomainBlock) => void;
  readonly refused: (block: DomainBlock) => void;
};

export class Restrictions {
  private gate: NavigationGate | null = null;
  private revision: number;
  private parent: Restrictions | null = null;
  private readonly children = new Set<Restrictions>();

  constructor(private readonly page: RestrictedPage) {
    this.revision = page.revision();
  }

  get restricted(): boolean {
    return this.gate !== null;
  }

  get state(): RestrictionState {
    return { restricted: this.restricted, revision: this.revision };
  }

  admit(policy: DomainPolicy | null, watch: number | null): NavigationAdmission {
    if (policy === null || (policy.allowed.length === 0 && policy.blocked.length === 0)) {
      return { gate: null, changes: this.operated(true) };
    }
    const pending = this.gate?.pending;
    const previous = pending != null && !pending.seen ? pending : null;
    if (this.gate !== null) {
      this.gate.policy = policy;
      this.gate.source = this;
      this.gate.watch = watch;
      this.gate.pending = previous;
      this.gate.failure = previous;
    } else {
      this.revision = this.page.revision();
      this.gate = { policy, source: this, watch, pending: previous, failure: previous };
    }
    this.page.navigation(true);
    const changes: Restriction[] = [];
    for (const member of this.family()) {
      if (member !== this) member.inheritGate(this.gate);
      const id = member.page.id();
      if (id !== null) changes.push({ page: id, ...member.state });
    }
    return { gate: this.gate, changes };
  }

  inherit(opener: Restrictions): void {
    this.parent?.children.delete(this);
    this.parent = opener;
    opener.children.add(this);
    if (opener.gate !== null) this.inheritGate(opener.gate);
  }

  private inheritGate(gate: NavigationGate): void {
    if (this.gate === null) {
      this.revision = this.page.revision();
      this.gate = { policy: gate.policy, source: gate.source, watch: null, pending: null, failure: null };
    } else {
      this.gate.policy = gate.policy;
      this.gate.source = gate.source;
    }
    this.page.navigation(true);
  }

  operated(snapshot = false): readonly Restriction[] {
    const changes: Restriction[] = [];
    for (const member of this.family()) {
      const restricted = member.gate !== null;
      if (restricted) {
        member.gate = null;
        member.revision = member.page.revision();
        member.page.navigation(false);
      }
      const id = member.page.id();
      if (id !== null && (snapshot || restricted)) changes.push({ page: id, ...member.state });
    }
    return changes;
  }

  private *family(): Generator<Restrictions> {
    let root: Restrictions = this;
    while (root.parent !== null) root = root.parent;
    const pending: Restrictions[] = [root];
    while (pending.length > 0) {
      const member = pending.pop()!;
      yield member;
      for (const child of member.children) pending.push(child);
    }
  }

  block(url: string): DomainBlock | null {
    const gate = this.gate;
    if (gate === null) return null;
    const block = domainBlock(gate.policy, url);
    if (block === null) return null;
    this.refuse(block);
    if (gate.source !== this) gate.source.refuse(block);
    return block;
  }

  private refuse(block: DomainBlock): void {
    const gate = this.gate;
    if (gate !== null && (gate.watch === null || gate.failure === null)) {
      const pending = gate.pending;
      gate.pending = pending !== null && !pending.seen ? pending : { block, seen: false };
      if (gate.watch !== null) {
        gate.failure = gate.pending;
        this.page.blocked(gate.watch, gate.failure.block);
      }
    }
    this.page.refused(block);
  }

  disconnect(): void {
    for (const member of this.family()) {
      if (member !== this && member.gate?.source === this) member.gate.source = member;
    }
    if (this.gate !== null) {
      this.gate.source = this;
      this.gate.watch = null;
      this.gate.pending = null;
      this.gate.failure = null;
      this.gate = null;
      this.revision = this.page.revision();
    }
    let parent = this.parent;
    parent?.children.delete(this);
    this.parent = null;
    for (const child of this.children) {
      child.parent = parent;
      if (parent === null) parent = child;
      else parent.children.add(child);
    }
    this.children.clear();
  }
}
