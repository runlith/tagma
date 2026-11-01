import { Schema } from 'effect';

export const Argv = Schema.NonEmptyArray(Schema.NonEmptyString);

export const RepositoryPath = Schema.String.check(Schema.isPattern(/^(?!\/)(?!(?:.*\/)?\.{1,2}(?:\/|$))[^\\]+$/u)).annotate({
  description: 'A file path from the repository root, without `.` or `..` segments.',
});

export const DeriveCommand = Schema.Struct({
  paths: Schema.NonEmptyArray(RepositoryPath),
  run: Argv,
});
export type DeriveCommand = typeof DeriveCommand.Type;
