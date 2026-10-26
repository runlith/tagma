import { Data } from 'effect';

export class InstallFailed extends Data.TaggedError('InstallFailed')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type McpDeclarationWrite = {
  readonly harness: string;
  readonly path: string;
  readonly write: 'created' | 'updated' | 'current' | 'refused';
  readonly detail?: string;
  readonly approved?: 'taken' | 'refused';
};

export const installFailure = (cause: unknown): InstallFailed =>
  cause instanceof InstallFailed ? cause : new InstallFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
