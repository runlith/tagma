import { Schema } from 'effect';
import type { FieldType, Tag } from './declaration.js';
import { ENFORCED, LAW } from './lawContracts.js';
import type { Tagged } from './roles.js';

export const DELIVERIES = ['prompt', 'code'] as const;
export type Delivery = (typeof DELIVERIES)[number];

export type RuleReach = {
  readonly delivery: Delivery;
  readonly sources: readonly string[];
  readonly places: readonly string[];
  readonly anchors: readonly string[];
};

export type LawReach = ReadonlyMap<number, RuleReach>;

export const lawFieldSchema = Schema.Struct({ field: Schema.NonEmptyString, schema: Schema.NonEmptyString });
export type LawField = typeof lawFieldSchema.Type;

export const lawProjectionSchema = Schema.Struct({
  type: Schema.NonEmptyString,
  enabled: lawFieldSchema,
  delivery: Schema.NullOr(lawFieldSchema),
  enforcement: Schema.NullOr(lawFieldSchema),
});
export type LawProjection = typeof lawProjectionSchema.Type;

function codecOf(type: FieldType): string {
  return typeof type === 'string' ? type : type.type === 'schema' ? type.name : type.type;
}

function lawFieldOf(tag: Tag, contract: typeof LAW | typeof ENFORCED, slot: string): LawField | null {
  const field = tag.contracts?.[contract]?.slots[slot];
  const type = field === undefined ? undefined : tag.fields[field];
  return field === undefined || type === undefined ? null : { field, schema: codecOf(type) };
}

export function projectLaw(tag: Tag): LawProjection | null {
  const enabled = lawFieldOf(tag, LAW, 'enabled');
  if (enabled === null) return null;
  return { type: tag.id, enabled, delivery: lawFieldOf(tag, LAW, 'delivery'), enforcement: lawFieldOf(tag, ENFORCED, 'enforcement') };
}

export function isEnabled(projection: LawProjection | null, node: Tagged): boolean {
  if (projection === null) return false;
  const raw = node.fields[projection.enabled.field];
  return raw !== false && raw !== 'false';
}

export function statedDelivery(projection: LawProjection | null, node: Tagged): Delivery | null {
  const raw = projection?.delivery === null || projection === null ? undefined : node.fields[projection.delivery.field];
  return DELIVERIES.find((one) => one === raw) ?? null;
}

export function deliveryOf(projection: LawProjection | null, node: Tagged, sourced: boolean): Delivery {
  return statedDelivery(projection, node) ?? (sourced ? 'code' : 'prompt');
}
