import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { InputReceipt, InputSequence } from '@runlith/executions/protocol/input';

export type Retained = {
  readonly binding: BindingId;
  readonly sequence: InputSequence;
  readonly receipt: InputReceipt;
  readonly bytes: Uint8Array;
};

export type ReceiptKey = string;

export const receiptKey = (binding: BindingId, sequence: InputSequence): ReceiptKey => `${binding}\u0000${sequence}`;

export type Lane = {
  readonly principal: Principal;
  readonly next: InputSequence;
  readonly active: number;
  readonly retainedFrom: InputSequence;
  readonly pressureRefusedAt: InputSequence | undefined;
};

export const emptyLane = (principal: Principal): Lane => ({
  principal,
  next: 0,
  active: 0,
  retainedFrom: 0,
  pressureRefusedAt: undefined,
});

export type LaneBook = {
  readonly lanes: ReadonlyMap<BindingId, Lane>;
  readonly clock: number;
  readonly receipts: ReadonlyMap<ReceiptKey, Retained>;
};

export type LaneOwner = { readonly id: BindingId; readonly principal: Principal };

export const laneOf = (held: LaneBook, binding: LaneOwner): Lane => held.lanes.get(binding.id) ?? emptyLane(binding.principal);

export const withLane = <Held extends LaneBook>(held: Held, binding: LaneOwner, lane: Lane): Held => ({
  ...held,
  lanes: new Map(held.lanes).set(binding.id, lane),
});

export const touched = <Held extends LaneBook>(held: Held, binding: LaneOwner): Held => {
  const lane = held.lanes.get(binding.id);
  if (lane === undefined) return held;
  const clock = held.clock + 1;
  return { ...held, clock, lanes: new Map(held.lanes).set(binding.id, { ...lane, active: clock }) };
};

const LANE_RECEIPTS = 32;

const retainedIn = (lanes: ReadonlyMap<BindingId, Lane>, binding: BindingId): number => {
  const lane = lanes.get(binding);
  return lane === undefined ? 0 : lane.next - lane.retainedFrom;
};

const forgetOldest = (lanes: Map<BindingId, Lane>, receipts: Map<ReceiptKey, Retained>, binding: BindingId): void => {
  const lane = lanes.get(binding);
  if (lane === undefined || lane.retainedFrom >= lane.next) return;
  receipts.delete(receiptKey(binding, lane.retainedFrom));
  lanes.set(binding, { ...lane, retainedFrom: lane.retainedFrom + 1 });
};

const leastActive = (lanes: ReadonlyMap<BindingId, Lane>): BindingId | undefined => {
  let idle: { readonly id: BindingId; readonly active: number } | undefined;
  for (const [id, lane] of lanes) {
    if (lane.next > lane.retainedFrom && (idle === undefined || lane.active < idle.active)) idle = { id, active: lane.active };
  }
  return idle?.id;
};

export const trimReceipts = (lanes: Map<BindingId, Lane>, receipts: Map<ReceiptKey, Retained>, binding: BindingId, total: number): void => {
  while (retainedIn(lanes, binding) > LANE_RECEIPTS) forgetOldest(lanes, receipts, binding);
  while (receipts.size > total) {
    const idle = leastActive(lanes);
    if (idle === undefined) break;
    forgetOldest(lanes, receipts, idle);
  }
};

export const keptLanes = (
  lanes: ReadonlyMap<BindingId, Lane>,
  receipts: ReadonlyMap<ReceiptKey, Retained>,
  drop: (id: BindingId, lane: Lane) => boolean,
): { readonly lanes: ReadonlyMap<BindingId, Lane>; readonly receipts: ReadonlyMap<ReceiptKey, Retained> } | undefined => {
  const kept = new Map<BindingId, Lane>();
  for (const [id, lane] of lanes) if (!drop(id, lane)) kept.set(id, lane);
  if (kept.size === lanes.size) return undefined;
  const retained = new Map<ReceiptKey, Retained>();
  for (const [key, entry] of receipts) if (kept.has(entry.binding)) retained.set(key, entry);
  return { lanes: kept, receipts: retained };
};

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
};
