import { Schema } from 'effect';
import type { HarnessField, HarnessProvenance } from '../../threads/contract/wire/harness/observation.js';
import { HARNESS_ID_MAX, type HarnessClaim } from '@runlith/tagma/adapter/harness';
import { MetadataInvalid } from './file.js';

export type MetadataValue = { readonly value: string; readonly claim: HarnessClaim; readonly turnId: string | null };
export type MetadataValues = {
  readonly model: MetadataValue | null;
  readonly effort: MetadataValue | null;
  readonly title: MetadataValue | null;
};

export const emptyValues = (): MetadataValues => ({ model: null, effort: null, title: null });

export const metadataText = Schema.String.check(Schema.isMaxLength(HARNESS_ID_MAX));

export const recordedValue = (value: string | null | undefined, turnId: string | null = null): MetadataValue | null =>
  value === undefined || value === null || value.trim() === '' ? null : { value, claim: 'last-recorded', turnId };

export const metadataField = (
  value: MetadataValue | null,
  source: HarnessProvenance,
  rootKey: string,
  observedAt: string,
  skipped = 0,
): HarnessField =>
  value !== null
    ? { _tag: 'Value', value: value.value, claim: value.claim, source, scope: { rootKey, turnId: value.turnId }, observedAt }
    : skipped > 0
      ? {
          _tag: 'Unreadable',
          source,
          scope: { rootKey, turnId: null },
          observedAt,
          reason: `records-past-limit:${skipped}`,
          lastKnown: null,
        }
      : { _tag: 'Absent', source, scope: { rootKey, turnId: null }, observedAt };

export const jsonValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new MetadataInvalid({ reason: 'malformed' });
  }
};

export const metadataDecode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownResult(schema);
  return (input: unknown): S['Type'] => {
    const result = decode(input);
    if (result._tag === 'Failure') throw new MetadataInvalid({ reason: 'malformed' });
    return result.success;
  };
};
