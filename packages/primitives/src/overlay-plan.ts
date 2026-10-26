import { relate, type ReadFact, type OverlaySpec } from './overlay-policy.js';

export type OverlayState = 'queued' | 'active' | 'suspended' | 'closing';

export type PlanEntry = {
  readonly spec: OverlaySpec;
  readonly state: OverlayState;
  readonly order: number;
  readonly ready: boolean;
  readonly preloading: boolean;
};

export type PlanHistory = {
  readonly steppedAside: ReadonlySet<string>;
  readonly promotingId: string | undefined;
  readonly cooling: ReadonlyMap<string, { readonly readyAtMs: number | undefined }>;
};

export const EMPTY_PLAN_HISTORY: PlanHistory = {
  steppedAside: new Set(),
  promotingId: undefined,
  cooling: new Map(),
};

export type PlanCommand =
  | { readonly kind: 'suspend'; readonly id: string }
  | { readonly kind: 'prepare'; readonly id: string }
  | { readonly kind: 'activate'; readonly id: string };

export type PlanResult = {
  readonly commands: readonly PlanCommand[];
  readonly history: PlanHistory;
  readonly wakeAtMs: number | undefined;
};

export function plan(entries: readonly PlanEntry[], read: ReadFact, history: PlanHistory, nowMs: number): PlanResult {
  const commands: PlanCommand[] = [];
  const cooling = new Map(history.cooling);
  const steppedAside = new Set(history.steppedAside);
  let promotingId = history.promotingId;
  let wakeAtMs: number | undefined;

  const raised = (facts: OverlaySpec['blockedBy']): boolean => facts.some((fact) => read(fact));

  for (const entry of entries) {
    if (!raised(entry.spec.blockedBy)) continue;
    if (entry.spec.unblockDelayMs > 0) cooling.set(entry.spec.id, { readyAtMs: undefined });
    if (entry.state === 'active') commands.push({ kind: 'suspend', id: entry.spec.id });
  }

  const finish = (): PlanResult => ({
    commands,
    history: { steppedAside, promotingId, cooling },
    wakeAtMs,
  });

  if (commands.length > 0 || entries.some((entry) => entry.state === 'closing')) return finish();

  const coolingNow = (entry: PlanEntry): boolean => {
    const record = cooling.get(entry.spec.id);
    if (record === undefined) return false;

    if (entry.spec.unblockDelayMs <= 0) {
      cooling.delete(entry.spec.id);
      return false;
    }

    const readyAtMs = record.readyAtMs ?? nowMs + entry.spec.unblockDelayMs;
    if (readyAtMs > nowMs) {
      cooling.set(entry.spec.id, { readyAtMs });
      if (wakeAtMs === undefined || readyAtMs < wakeAtMs) wakeAtMs = readyAtMs;
      return true;
    }

    cooling.delete(entry.spec.id);
    return false;
  };

  const activeSims: PlanEntry[] = entries.filter((entry) => entry.state === 'active');
  const activatedIds = new Set<string>();
  const reserved: PlanEntry[] = [];

  const pending = (): PlanEntry[] =>
    entries
      .filter(
        (entry) => entry.spec.arbitrated && (entry.state === 'queued' || entry.state === 'suspended') && !activatedIds.has(entry.spec.id),
      )
      .sort((left, right) => {
        if (left.spec.id === promotingId) return -1;
        if (right.spec.id === promotingId) return 1;
        if (left.state !== right.state) return left.state === 'queued' ? -1 : 1;
        if (left.spec.priority !== right.spec.priority) return right.spec.priority - left.spec.priority;
        return left.order - right.order;
      });

  const findPromotion = (): { candidate: PlanEntry; suspend: PlanEntry[]; displaced: PlanEntry[] } | undefined => {
    for (const candidate of pending()) {
      if (reserved.includes(candidate)) continue;
      if (steppedAside.has(candidate.spec.id)) continue;
      if (raised(candidate.spec.blockedBy)) continue;
      const isCooling = coolingNow(candidate);
      if (raised(candidate.spec.heldBy)) continue;
      if (isCooling) continue;

      const suspend: PlanEntry[] = [];
      const displaced: PlanEntry[] = [];
      let wait = false;

      for (const occupant of [...activeSims, ...reserved]) {
        const relation = relate(candidate.spec, occupant.spec, read);
        if (relation === 'coexist') continue;
        if (relation === 'wait') {
          wait = true;
          break;
        }
        if (reserved.includes(occupant)) displaced.push(occupant);
        else suspend.push(occupant);
      }

      if (wait) continue;
      return { candidate, suspend, displaced };
    }

    return undefined;
  };

  let turns = entries.length + 1;
  while (turns-- > 0) {
    const promotion = findPromotion();
    if (!promotion) return finish();

    for (const weaker of promotion.displaced) reserved.splice(reserved.indexOf(weaker), 1);

    if (promotion.suspend.length > 0) {
      promotingId = promotion.candidate.spec.id;
      for (const occupant of promotion.suspend) {
        steppedAside.add(occupant.spec.id);
        commands.push({ kind: 'suspend', id: occupant.spec.id });
      }
      return finish();
    }

    if (!promotion.candidate.ready) {
      if (!promotion.candidate.preloading) commands.push({ kind: 'prepare', id: promotion.candidate.spec.id });
      reserved.push(promotion.candidate);
      continue;
    }

    commands.push({ kind: 'activate', id: promotion.candidate.spec.id });
    activatedIds.add(promotion.candidate.spec.id);
    activeSims.push(promotion.candidate);
    if (promotingId === promotion.candidate.spec.id) promotingId = undefined;
  }

  return finish();
}
