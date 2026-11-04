import { explains, type Role, WRITER } from './roles.js';

export const WRITE_GAP_MS = 20;

export type Span = { readonly from: number; readonly to: number };

export type Command = {
  readonly id: string | null;
  readonly role: Role;
  readonly signatures: readonly (string | null)[];
  readonly team: string | null;
  readonly line: string | null;
};

export type Life = {
  readonly threadId: string;
  readonly command: Command;
  start: number | null;
  end: number | null;
};

export type Moved = { readonly name: string; readonly after: string; readonly written: Span | null };

export type Basis = 'nobody' | 'marks' | 'sets' | 'unproven' | 'overlap' | 'team' | 'untouched';

export type Claim = (
  | { readonly kind: 'mine' }
  | { readonly kind: 'taken'; readonly by: string }
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'overlap' }
  | { readonly kind: 'team'; readonly root: string }
) & { readonly basis: Basis; readonly counted: boolean; readonly sole: boolean };

export const UNKNOWN_COMMAND: Command = { id: null, role: WRITER, signatures: [], team: null, line: null };

type Instant = { readonly threadId: string; readonly after: string; readonly from: number; to: number | null };

export type InstantMark = { readonly landed: () => void; readonly undo: () => void };

type Unowned = { readonly after: string; readonly at: number };

type Hold = { readonly from: number };

type Checkout = {
  readonly lives: Set<Life>;
  readonly instants: Map<string, Instant[]>;
  readonly unowned: Map<string, Unowned[]>;
  readonly holds: Set<Hold>;
};

type Candidate = { readonly life: Life; readonly threadId: string; readonly start: number; readonly end: number; readonly role: Role };

export type Decider = (moved: Moved) => Claim;

const meets = (one: Candidate, span: Span): boolean => one.start <= span.to && one.end >= span.from;

const threadsOf = (candidates: readonly Candidate[]): ReadonlySet<string> => new Set(candidates.map((one) => one.threadId));

const teamOf = (left: readonly Candidate[]): string | null => {
  const team = left[0]?.life.command.team ?? null;
  return team !== null && left.every((one) => one.life.command.team === team) ? team : null;
};

const verdict = (
  threads: ReadonlySet<string>,
  deciding: Life,
  proof: 'marks' | 'sets' | null,
  counted = false,
  sole = false,
  team: string | null = null,
): Claim => {
  const ours = threads.has(deciding.threadId);
  if (threads.size > 1) {
    if (!ours) return { kind: 'unclaimed', basis: team === null ? 'overlap' : 'team', counted: false, sole: false };
    return team === null
      ? { kind: 'overlap', basis: 'overlap', counted, sole: false }
      : { kind: 'team', root: team, basis: 'team', counted, sole: false };
  }
  if (proof === null)
    return ours
      ? team === null
        ? { kind: 'overlap', basis: 'unproven', counted, sole }
        : { kind: 'team', root: team, basis: 'team', counted, sole }
      : { kind: 'unclaimed', basis: team === null ? 'unproven' : 'team', counted: false, sole: false };
  if (ours) return { kind: 'mine', basis: proof, counted, sole };
  const [only] = threads as Set<string>;
  return { kind: 'taken', by: only as string, basis: proof, counted: false, sole: false };
};

const lastOf = (left: readonly Candidate[], deciding: Life, now: number): boolean =>
  left.some((one) => one.threadId === deciding.threadId) && left.every((one) => one.end <= (deciding.end ?? now));

const plausible = (candidates: readonly Candidate[]): readonly Candidate[] => {
  const writers = candidates.filter((one) => one.role.kind === 'writer');
  return writers.length === 0 ? candidates : writers;
};

export class Living {
  private closed = false;

  constructor(
    readonly life: Life,
    private readonly release: () => void,
    private readonly drop: () => void,
    private readonly now: () => number,
  ) {}

  readonly opened = (): void => {
    if (this.life.start === null) this.life.start = this.now();
  };

  readonly ended = (): void => {
    if (this.life.start === null || this.life.end !== null) return;
    this.life.end = this.now();
  };

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    if (this.life.start === null) this.drop();
    else this.ended();
    this.release();
  };

  readonly forget = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.drop();
    this.release();
  };
}

export class Lives {
  private readonly checkouts = new Map<string, Checkout>();

  constructor(private readonly now: () => number = Date.now) {}

  readonly open = (key: string, threadId: string, command: Command = UNKNOWN_COMMAND): Living => this.living(key, threadId, command, true);

  readonly reading = (key: string, threadId: string): Living => this.living(key, threadId, UNKNOWN_COMMAND, false);

  private living(key: string, threadId: string, command: Command, writes: boolean): Living {
    const checkout = this.checkout(key);
    const life: Life = { threadId, command, start: null, end: null };
    if (writes) checkout.lives.add(life);
    const release = this.hold(key, this.now());
    return new Living(life, release, () => checkout.lives.delete(life), this.now);
  }

  readonly restore = (key: string, threadId: string, command: Command, start: number, end: number): Life => {
    const life: Life = { threadId, command, start, end };
    this.checkout(key).lives.add(life);
    return life;
  };

  readonly instant = (key: string, threadId: string, name: string, after: string, from: number, to: number | null): InstantMark => {
    const mark: Instant = { threadId, after, from, to };
    return {
      landed: () => {
        if (mark.to === null) mark.to = this.now();
      },
      undo: this.mark(key, (checkout) => checkout.instants, name, mark),
    };
  };

  readonly instants = (
    key: string,
    threadId: string,
    asked: readonly { readonly name: string; readonly after: string; readonly from: number }[],
  ): readonly InstantMark[] => {
    const made = asked.map(({ name, after, from }) => {
      const mark: Instant = { threadId, after, from, to: null };
      return { name, mark };
    });
    const undone = this.marks(key, (checkout) => checkout.instants, made);
    return made.map(({ mark }, at) => ({
      landed: () => {
        if (mark.to === null) mark.to = this.now();
      },
      undo: undone[at]!,
    }));
  };

  readonly unowned = (key: string, name: string, after: string, at: number): (() => void) =>
    this.mark(key, (checkout) => checkout.unowned, name, { after, at });

  private mark<M>(key: string, marks: (checkout: Checkout) => Map<string, M[]>, name: string, mark: M): () => void {
    return this.marks(key, marks, [{ name, mark }])[0]!;
  }

  private marks<M>(
    key: string,
    marks: (checkout: Checkout) => Map<string, M[]>,
    made: readonly { readonly name: string; readonly mark: M }[],
  ): readonly (() => void)[] {
    const checkout = this.checkout(key);
    const named = marks(checkout);
    for (const { name, mark } of made) {
      const known = named.get(name);
      if (known === undefined) named.set(name, [mark]);
      else known.push(mark);
    }
    if (checkout.holds.size === 0) this.prune(key);
    return made.map(({ name, mark }) => () => {
      const standing = named.get(name);
      if (standing === undefined) return;
      const kept = standing.filter((one) => one !== mark);
      if (kept.length === 0) named.delete(name);
      else named.set(name, kept);
    });
  }

  readonly hold = (key: string, from: number): (() => void) => {
    const checkout = this.checkout(key);
    const hold: Hold = { from };
    checkout.holds.add(hold);
    return () => {
      if (checkout.holds.delete(hold)) this.prune(key);
    };
  };

  readonly decider = (key: string, deciding: Life, window: Span): Decider => {
    const checkout = this.checkouts.get(key);
    if (checkout === undefined) return () => ({ kind: 'unclaimed', basis: 'untouched', counted: true, sole: false });
    const now = this.now();
    const living: Candidate[] = [];
    for (const life of checkout.lives) {
      if (life.start === null) continue;
      const one = { life, threadId: life.threadId, start: life.start, end: life.end ?? now, role: life.command.role };
      if (meets(one, window)) living.push(one);
    }
    const marked = (moved: Moved, span: Span): ReadonlySet<string> =>
      new Set(
        (checkout.instants.get(moved.name) ?? [])
          .filter((instant) => instant.after === moved.after && instant.from <= span.to && (instant.to ?? now) >= span.from)
          .map((instant) => instant.threadId),
      );
    const lived = (span: Span): readonly Candidate[] => living.filter((one) => meets(one, span));
    const nobodys = (moved: Moved, near: Span | null): boolean => {
      const marks = (checkout.unowned.get(moved.name) ?? []).filter((one) => one.after === moved.after);
      const within = (span: Span): boolean => marks.some((one) => one.at >= span.from && one.at <= span.to);
      return (near !== null && within(near)) || within(window);
    };
    return (moved) => {
      const near = moved.written === null ? null : { from: moved.written.from - WRITE_GAP_MS, to: moved.written.to + WRITE_GAP_MS };
      if (nobodys(moved, near)) return { kind: 'unclaimed', basis: 'nobody', counted: false, sole: false };
      const writers = near === null ? new Set<string>() : marked(moved, near);
      if (writers.size > 0) return verdict(writers, deciding, 'marks');
      const windowWriters = marked(moved, window);
      if (windowWriters.size > 0) return verdict(windowWriters, deciding, 'marks');
      const candidates = lived(near ?? window);
      if (candidates.length === 0) return { kind: 'unclaimed', basis: 'untouched', counted: true, sole: false };
      const sole = candidates.length === 1 && candidates[0]?.life === deciding;
      const declaring = candidates.filter((one) => explains(one.role, moved.name));
      const left = declaring.length > 0 ? declaring : plausible(candidates);
      return verdict(threadsOf(left), deciding, declaring.length > 0 ? 'sets' : null, lastOf(left, deciding, now), sole, teamOf(left));
    };
  };

  readonly decide = (key: string, deciding: Life, moved: Moved, window: Span): Claim => this.decider(key, deciding, window)(moved);

  readonly openedSince = (key: string, at: number): boolean => {
    const checkout = this.checkouts.get(key);
    if (checkout === undefined) return false;
    for (const life of checkout.lives) if (life.start === null || life.start >= at) return true;
    return false;
  };

  private checkout(key: string): Checkout {
    const known = this.checkouts.get(key);
    if (known !== undefined) return known;
    const fresh: Checkout = {
      lives: new Set(),
      instants: new Map(),
      unowned: new Map(),
      holds: new Set(),
    };
    this.checkouts.set(key, fresh);
    return fresh;
  }

  private prune(key: string): void {
    const checkout = this.checkouts.get(key);
    if (checkout === undefined) return;
    let horizon = this.now();
    for (const hold of checkout.holds) horizon = Math.min(horizon, hold.from);
    horizon -= WRITE_GAP_MS;
    for (const life of checkout.lives) if (life.end !== null && life.end < horizon) checkout.lives.delete(life);
    for (const [name, instants] of checkout.instants) {
      const kept = instants.filter((instant) => instant.to === null || instant.to >= horizon);
      if (kept.length === 0) checkout.instants.delete(name);
      else checkout.instants.set(name, kept);
    }
    for (const [name, unowned] of checkout.unowned) {
      const kept = unowned.filter((one) => one.at >= horizon);
      if (kept.length === 0) checkout.unowned.delete(name);
      else checkout.unowned.set(name, kept);
    }
    if (checkout.lives.size === 0 && checkout.instants.size === 0 && checkout.unowned.size === 0 && checkout.holds.size === 0)
      this.checkouts.delete(key);
  }
}
