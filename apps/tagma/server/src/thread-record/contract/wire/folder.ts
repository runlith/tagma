import { Schema } from 'effect';

export const FOLDER_NAME_CHARS = 80;

export const threadFolderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  position: Schema.Int,
  parentId: Schema.NullOr(Schema.String),
});
export type ThreadFolder = typeof threadFolderSchema.Type;

export const folderNameOf = (raw: string): string | null => {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_CHARS).trim();
  return name === '' ? null : name;
};
