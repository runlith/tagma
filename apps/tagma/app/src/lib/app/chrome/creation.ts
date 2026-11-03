import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import type { Told } from '$lib/wire/told.js';
import { type Gated, gatedBy } from '$lib/wire/access.js';

export type CreationDraft = { readonly name: string; readonly rootPath: string; readonly storage: StorageMode };

export type CreationPlace = 'new' | 'carried' | 'source';

export type CreationFieldProps = {
  draft: CreationDraft;
  value: unknown;
  put: (value: unknown) => void;
  refused: Told | null;
  place: CreationPlace;
};

export interface CreationField extends Shown<CreationFieldProps>, Gated<Shown<CreationFieldProps>['payload']> {
  readonly id: string;
  readonly order: number;
  readonly places?: readonly Exclude<CreationPlace, 'source'>[];
  readonly source?: string;
}

export const standsIn = (field: CreationField, place: CreationPlace): boolean =>
  place === 'source' ? field.source !== undefined : (field.places ?? (field.source === undefined ? ['new'] : [])).includes(place);

export const CreationFields = Point.define<CreationField>()('CreationFields', {
  tier: 'app',
  key: (field) => field.id,
  order: (field) => field.order,
  draws: gatedBy('write'),
});
