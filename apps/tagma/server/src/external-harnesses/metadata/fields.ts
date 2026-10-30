import type { HarnessProvenance } from '@runlith/tagma/adapter/harness';
import type { MetadataValue } from '@runlith/tagma/adapter/metadata';
import type { HarnessField } from '../../threads/contract/wire/harness/observation.js';

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
