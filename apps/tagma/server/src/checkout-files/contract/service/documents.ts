import { Context, type Effect, type Stream } from 'effect';
import type { LineEdit } from '@runlith/files/lines';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { CheckoutPlace } from '../../../workspace/contract/service/checkoutPaths.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';
import type { DocumentFrame } from '../wire/document.js';

export type DocumentRefusal = 'path-outside-tree' | 'graph-path' | 'files';

export type FileRefusal = 'files' | 'file-write-failed' | 'not-text' | 'too-large' | 'not-a-file' | 'edits-invalid' | 'worker-unavailable';

export type SaveRefusal = DocumentRefusal | 'record-unread' | FileRefusal | GitRefusal;

export type LooseRefusal = 'path-relative' | 'in-checkout' | 'files';

export type Save = {
  readonly path: string;
  readonly base: string | null;
  readonly write: string;
  readonly edits: readonly LineEdit[] | undefined;
  readonly text: string | undefined;
};

export type Saved =
  | { readonly status: 'ok'; readonly digest: string; readonly kept: boolean; readonly unconfirmed: string | null }
  | { readonly status: 'moved'; readonly digest: string | null };

export class Documents extends Context.Service<
  Documents,
  {
    subscribe(place: ProjectRoot, path: string): Stream.Stream<DocumentFrame, GateRefusal<DocumentRefusal> | RootResolutionFailure>;
    save(place: ProjectRoot, save: Save): Effect.Effect<Saved, GateRefusal<SaveRefusal>>;
    placeOf(projectId: number, abs: string): Effect.Effect<CheckoutPlace | null, GateRefusal<'files'>>;
    subscribeLoose(projectId: number, path: string): Stream.Stream<DocumentFrame, GateRefusal<LooseRefusal>>;
    saveLoose(projectId: number, save: Save): Effect.Effect<Saved, GateRefusal<FileRefusal | LooseRefusal>>;
  }
>()('tagma/checkout-files/Documents') {}
