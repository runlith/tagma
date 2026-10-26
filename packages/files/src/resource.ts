import * as Schema from 'effect/Schema';
import { NamespaceId } from './namespace';

export const ResourceAddress = Schema.Struct({
  namespaceId: NamespaceId,
  path: Schema.NonEmptyString,
});
export type ResourceAddress = typeof ResourceAddress.Type;

export const LocationRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('LocationRevision'));
export type LocationRevision = typeof LocationRevision.Type;
