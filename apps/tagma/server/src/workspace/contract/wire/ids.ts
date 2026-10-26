import * as Schema from 'effect/Schema';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const WorkspaceGeneration = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('WorkspaceGeneration'));
export type WorkspaceGeneration = typeof WorkspaceGeneration.Type;

export const RootId = Schema.NonEmptyString.pipe(Schema.brand('RootId')).annotate(placeRole('checkout'));
export type RootId = typeof RootId.Type;

export const UseId = Schema.NonEmptyString.pipe(Schema.brand('UseId'));
export type UseId = typeof UseId.Type;
