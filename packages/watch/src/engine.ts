/// <reference types="bun" />

import { fileURLToPath } from 'node:url';
import { CString, dlopen, FFIType, ptr, type Pointer } from 'bun:ffi';
import type { WatchChange } from './protocol.js';

export const LIBRARY = fileURLToPath(new URL('./watch.native', import.meta.url));

const SYMBOLS = {
  watch_error: { args: [], returns: FFIType.ptr },
  watch_open: { args: [], returns: FFIType.ptr },
  watch_wake: { args: [FFIType.ptr], returns: FFIType.i32 },
  watch_subscribe: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
  watch_unsubscribe: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  watch_snapshot: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
  watch_since: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
  watch_take: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
} as const;

const CREATED = 1;
const UPDATED = 2;
const DELETED = 3;
const DROPPED = 4;
const ENDED = 5;
const SUBSCRIBED = 6;
const REFUSED = 7;
const UNSUBSCRIBED = 8;
const WRITTEN = 9;
const SETTLED = 10;

const TAKE_BYTES = 1 << 20;

export type EngineHearing = {
  readonly heard: (changes: readonly WatchChange[]) => void;
  readonly dropped: (subtree: string | null, reason: string) => void;
  readonly ended: (reason: string) => void;
};

export type Engine = {
  readonly subscribe: (root: string, recursive: boolean, exclusions: readonly string[], hearing: EngineHearing) => Promise<number>;
  readonly unsubscribe: (id: number) => Promise<void>;
  readonly snapshot: (root: string, exclusions: readonly string[], file: string) => Promise<void>;
  readonly since: (root: string, exclusions: readonly string[], file: string) => Promise<WatchChange[] | null>;
};

type Waiting = {
  readonly done: (said: number, text: string, changes: WatchChange[]) => void;
  readonly changes: WatchChange[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesOf = (text: string): Uint8Array => encoder.encode(text);

export const openEngine = (library: string = LIBRARY): Engine => {
  const native = dlopen(library, SYMBOLS).symbols;
  const failure = (): Error => {
    const pointer = native.watch_error();
    return new Error(pointer === null ? 'the watch engine failed without a reason' : new CString(pointer).toString());
  };
  const handle = native.watch_open() as Pointer | null;
  if (handle === null) throw failure();
  const engine = handle;
  const hearings = new Map<number, EngineHearing>();
  const waiting = new Map<number, Waiting>();
  let next = 0;

  const asked = (id: number, call: (id: number) => number): Promise<{ said: number; text: string; changes: WatchChange[] }> =>
    new Promise((resolve, reject) => {
      waiting.set(id, { done: (said, text, changes) => resolve({ said, text, changes }), changes: [] });
      if (call(id) < 0) {
        waiting.delete(id);
        reject(failure());
      }
    });

  const landing = new Uint8Array(TAKE_BYTES);
  const view = new DataView(landing.buffer);

  const drain = (): void => {
    const heard = new Map<number, WatchChange[]>();
    const told: Array<() => void> = [];
    for (;;) {
      const length = native.watch_take(engine, ptr(landing), landing.length);
      if (length < 0) throw failure();
      if (length === 0) break;
      let at = 0;
      while (at < length) {
        const id = view.getUint32(at, true);
        const kind = landing[at + 4]!;
        const flag = landing[at + 5]!;
        const pathLength = view.getUint32(at + 6, true);
        const path = decoder.decode(landing.subarray(at + 10, at + 10 + pathLength));
        const textAt = at + 10 + pathLength;
        const textLength = view.getUint32(textAt, true);
        const text = decoder.decode(landing.subarray(textAt + 4, textAt + 4 + textLength));
        at = textAt + 4 + textLength;
        if (kind === CREATED || kind === UPDATED || kind === DELETED) {
          const stamp =
            textLength === 16
              ? { heard: { from: Number(view.getBigUint64(textAt + 4, true)), to: Number(view.getBigUint64(textAt + 12, true)) } }
              : {};
          const change: WatchChange =
            kind === CREATED
              ? flag === 1
                ? { kind: 'create', path, directory: true, ...stamp }
                : { kind: 'create', path, ...stamp }
              : { kind: kind === UPDATED ? 'update' : 'delete', path, ...stamp };
          if (hearings.has(id)) {
            const list = heard.get(id) ?? [];
            list.push(change);
            heard.set(id, list);
          } else waiting.get(id)?.changes.push(change);
          continue;
        }
        if (kind === DROPPED || kind === ENDED) {
          const hearing = hearings.get(id);
          if (hearing === undefined) continue;
          const before = heard.get(id) ?? [];
          heard.delete(id);
          if (kind === ENDED) hearings.delete(id);
          told.push(() => {
            if (before.length > 0) hearing.heard(before);
            if (kind === DROPPED) hearing.dropped(path === '' ? null : path, text);
            else hearing.ended(text);
          });
          continue;
        }
        const request = waiting.get(id);
        if (request === undefined) continue;
        waiting.delete(id);
        const said = kind === SETTLED ? (flag === 1 ? SETTLED : -SETTLED) : kind;
        told.push(() => request.done(said, text, request.changes));
      }
    }
    for (const one of told) one();
    for (const [id, changes] of heard) hearings.get(id)?.heard(changes);
  };

  void (async () => {
    for await (const _ of Bun.file(native.watch_wake(engine)).stream()) drain();
  })();

  const refused = (said: number, text: string, wanted: number): void => {
    if (said !== wanted) throw new Error(said === REFUSED ? text : `the watch engine answered ${said}`);
  };

  return {
    subscribe: async (root, recursive, exclusions, hearing) => {
      const rootBytes = bytesOf(root);
      const excluded = bytesOf(exclusions.join('\0'));
      const id = ++next;
      hearings.set(id, hearing);
      const answer = await asked(id, () =>
        native.watch_subscribe(
          engine,
          id,
          ptr(rootBytes),
          rootBytes.length,
          recursive ? 1 : 0,
          excluded.length === 0 ? null : ptr(excluded),
          excluded.length,
        ),
      ).catch((cause: unknown) => {
        hearings.delete(id);
        throw cause;
      });
      if (answer.said !== SUBSCRIBED) hearings.delete(id);
      refused(answer.said, answer.text, SUBSCRIBED);
      return id;
    },
    unsubscribe: async (id) => {
      hearings.delete(id);
      const answer = await asked(id, () => native.watch_unsubscribe(engine, id));
      refused(answer.said, answer.text, UNSUBSCRIBED);
    },
    snapshot: async (root, exclusions, file) => {
      const [rootBytes, excluded, fileBytes] = [bytesOf(root), bytesOf(exclusions.join('\0')), bytesOf(file)];
      const answer = await asked(++next, (id) =>
        native.watch_snapshot(
          engine,
          id,
          ptr(rootBytes),
          rootBytes.length,
          excluded.length === 0 ? null : ptr(excluded),
          excluded.length,
          ptr(fileBytes),
          fileBytes.length,
        ),
      );
      refused(answer.said, answer.text, WRITTEN);
    },
    since: async (root, exclusions, file) => {
      const [rootBytes, excluded, fileBytes] = [bytesOf(root), bytesOf(exclusions.join('\0')), bytesOf(file)];
      const answer = await asked(++next, (id) =>
        native.watch_since(
          engine,
          id,
          ptr(rootBytes),
          rootBytes.length,
          excluded.length === 0 ? null : ptr(excluded),
          excluded.length,
          ptr(fileBytes),
          fileBytes.length,
        ),
      );
      if (answer.said === -SETTLED) return null;
      refused(answer.said, answer.text, SETTLED);
      return answer.changes;
    },
  };
};
