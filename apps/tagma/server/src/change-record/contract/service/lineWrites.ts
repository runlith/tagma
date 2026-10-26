import { Context, type Effect, type FileSystem } from 'effect';
import type { RunFilesFailure } from './runFiles.js';
import type { ReshapeMode } from '../wire/reshape.js';

export type LineReplacement = {
  readonly root: string;
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly mode?: ReshapeMode;
  readonly publishing?: () => () => void;
};

export class LineWrites extends Context.Service<
  LineWrites,
  {
    replace(
      replacement: LineReplacement,
      approved: Effect.Effect<boolean, RunFilesFailure>,
    ): Effect.Effect<boolean, RunFilesFailure, FileSystem.FileSystem>;
  }
>()('tagma/change-record/LineWrites') {}
