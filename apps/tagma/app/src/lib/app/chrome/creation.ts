import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import type { Told } from '$lib/wire/told.js';

export type CreationDraft = { readonly name: string; readonly rootPath: string; readonly storage: StorageMode };

export type CreationFieldProps = {
  draft: CreationDraft;
  value: unknown;
  put: (value: unknown) => void;
  refused: Told | null;
};

export interface CreationField extends Shown<CreationFieldProps> {
  readonly id: string;
  readonly order: number;
}

export const CreationFields = Point.define<CreationField>()('CreationFields', {
  tier: 'app',
  key: (field) => field.id,
  order: (field) => field.order,
});
