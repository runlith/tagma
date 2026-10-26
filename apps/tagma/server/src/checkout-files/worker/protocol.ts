import type { LineHunk } from '@runlith/files/hunk';
import type { LineEdit } from '@runlith/files/lines';
import type { FoundFile } from '../contract/wire/paths.js';

export type FilesAsk =
  | { readonly kind: 'load'; readonly root: string; readonly generation: number; readonly paths: readonly string[] }
  | {
      readonly kind: 'patch';
      readonly root: string;
      readonly generation: number;
      readonly scanned: readonly string[];
      readonly found: readonly string[];
    }
  | {
      readonly kind: 'find';
      readonly root: string;
      readonly generation: number;
      readonly query: string;
      readonly limit: number;
      readonly recent: readonly string[];
    }
  | { readonly kind: 'drop'; readonly root: string; readonly generation: number }
  | { readonly kind: 'order'; readonly names: readonly string[]; readonly dirs: readonly boolean[] }
  | { readonly kind: 'diff'; readonly before: string; readonly after: string }
  | { readonly kind: 'digest'; readonly paths: readonly string[] }
  | { readonly kind: 'hash'; readonly bytes: Uint8Array }
  | { readonly kind: 'change'; readonly before: string; readonly after: string; readonly normalized: boolean };

export type FilesReply =
  | { readonly kind: 'done' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'found'; readonly files: readonly FoundFile[]; readonly matched: number }
  | { readonly kind: 'ordered'; readonly order: readonly number[] }
  | { readonly kind: 'edited'; readonly edits: readonly LineEdit[] | null }
  | { readonly kind: 'digested'; readonly digests: readonly Digested[] }
  | { readonly kind: 'hashed'; readonly digest: string }
  | { readonly kind: 'changed'; readonly digest: string; readonly hunk: LineHunk | null };

export type Digested = string | null | { readonly unread: string };

export const CANCEL_SLOTS = 4096;

export type FilesEnvelope = { readonly id: number; readonly cancelled: SharedArrayBuffer; readonly ask: FilesAsk };

export type FilesAnswer = { readonly id: number; readonly reply: FilesReply };
