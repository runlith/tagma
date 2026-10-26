import { type AssembledOf, catalogOf, type EncodedInspectionOf, type InspectionOf } from './core/catalog';
import { architecture } from './packs/architecture/manifest';
import { effect } from './packs/effect/manifest';
import { js } from './packs/js/manifest';

const SHIPPED = catalogOf([js, effect, architecture]);

export const PACKS = SHIPPED.packs;

export const BUILTINS = SHIPPED.rules;

export type BuiltinId = keyof typeof BUILTINS;

export type PackId = (typeof PACKS)[number]['id'];

export const BUILTIN_IDS: readonly BuiltinId[] = SHIPPED.ids;

export type Params<K extends BuiltinId> = (typeof BUILTINS)[K]['params']['Type'];

export type Inspection = InspectionOf<typeof PACKS>;

export type EncodedInspection = EncodedInspectionOf<typeof PACKS>;

export type Assembled = AssembledOf<typeof PACKS>;

export const {
  describe,
  takesMap,
  mapProblem,
  assembled,
  shows,
  relevant,
  follows,
  relocated,
  modulesRenamed,
  sliceable,
  languagesOf,
  envelopeOf,
  packOf,
  listsOf,
  used,
} = SHIPPED;
