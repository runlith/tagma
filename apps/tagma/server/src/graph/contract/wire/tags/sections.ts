import { Schema } from 'effect';

export const SECTION_EDITS = ['append', 'replace', 'hide'] as const;
export type SectionEdit = (typeof SECTION_EDITS)[number];

export const sectionOriginSchema = Schema.Struct({
  edit: Schema.Literals(SECTION_EDITS),
  over: Schema.NonEmptyString,
});
export type SectionOrigin = typeof sectionOriginSchema.Type;

export const sectionSchema = Schema.Struct({
  key: Schema.NonEmptyString,
  text: Schema.String,
  edits: Schema.optional(Schema.Array(Schema.Literals(SECTION_EDITS))),
});
export type Section = typeof sectionSchema.Type;

export const tagSectionsSchema = Schema.Array(sectionSchema);

export const PROJECT_SECTION = 'project';

export const shippedSections = (key: string, text: string): readonly Section[] => [
  { key, text },
  { key: PROJECT_SECTION, text: '', edits: ['append'] },
];

export const layerEditSchema = Schema.Struct({
  section: Schema.NonEmptyString,
  edit: Schema.Literals(SECTION_EDITS),
  text: Schema.optional(Schema.String),
  over: Schema.NonEmptyString,
});
export type LayerEdit = typeof layerEditSchema.Type;

export const keyedLayerSchema = Schema.Struct({ type: Schema.NonEmptyString, edits: Schema.Array(layerEditSchema) });
export type KeyedLayer = typeof keyedLayerSchema.Type;

export const forkSchema = Schema.Struct({
  library: Schema.NonEmptyString,
  export: Schema.NonEmptyString,
  at: Schema.NonEmptyString,
});
export type Fork = typeof forkSchema.Type;

export const guidanceForkSchema = Schema.Struct({ at: Schema.NonEmptyString });
export type GuidanceFork = typeof guidanceForkSchema.Type;
