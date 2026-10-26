import { Data, type Effect, type Scope } from 'effect';

export type ImportNamespace = {
  readonly kind: string;
  readonly id: string;
};

export class ImportSourceRefused extends Data.TaggedError('ImportSourceRefused')<{
  readonly code: string;
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export type ImportedSource = {
  readonly text: string;
  readonly from: string;
};

export type WorkspaceImports = {
  readonly open: (namespace: ImportNamespace, path: string) => Effect.Effect<ImportedSource, ImportSourceRefused, Scope.Scope>;
};
