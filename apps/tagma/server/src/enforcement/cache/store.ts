import { Database } from 'bun:sqlite';
import { selectEngine } from '@runlith/sqlite-process/engine';
import { Data } from 'effect';
import type { InspectionMemo, MemoValue, ReachApplied, ReachHead, ReachTable, ReachView } from '@tagma/inspection/node/memo';
import type { ParseMemo } from '@runlith/code-facts/blobs';
import type { ImportSite, ReachDelta } from '@runlith/code-facts/imports';
import { mkdirSync, rmSync, statfsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname } from 'node:path';
import {
  cacheBudget,
  cacheWrites,
  calibrationKeyOf,
  readCacheRecord,
  readCalibrationRecord,
  recordDigest,
  type CalibrationRecord,
} from './record.js';
import type { Calibration } from '@tagma/inspection/node/budget';

type Row = { readonly body: string; readonly digest: string };
type IndexRow = { readonly id: number; readonly tree: string; readonly generation: number; readonly members: string };
type NodeRow = { readonly object: string; readonly rank: number; readonly body: string };
type Body<N> = { readonly out: readonly string[]; readonly watch: readonly string[]; readonly note: N };
type Aged = { readonly source: 'entry' | 'reach' | 'rest'; readonly key: string; readonly bytes: number; readonly touched: number };
export class CacheDegraded extends Data.TaggedError('CacheDegraded')<{
  readonly code: string;
  readonly detail: string;
}> {}

const TOUCH_WINDOW = 64;
const TOUCHES_KEPT = 262_144;

const codeOf = (error: unknown): string | undefined =>
  error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;

const damaged = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && (error.code === 'SQLITE_CORRUPT' || error.code === 'SQLITE_NOTADB');

export function openCache(path: string, envelope: number, degraded: (cause: CacheDegraded) => void) {
  selectEngine();
  const reported = new Set<string>();
  const degrade = (error: unknown): void => {
    const code = codeOf(error) ?? 'unknown';
    if (reported.has(code)) return;
    reported.add(code);
    degraded(new CacheDegraded({ code, detail: error instanceof Error ? error.message : String(error) }));
  };
  mkdirSync(dirname(path), { recursive: true });
  const disk = statfsSync(dirname(path));
  const budget = cacheBudget(disk.bavail * disk.bsize, envelope);
  const reset = (): void => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${path}${suffix}`, { force: true });
  };
  const open = (): Database => {
    const db = new Database(path, { create: true });
    try {
      db.exec('PRAGMA busy_timeout = 1000');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      db.transaction(() => {
        db.exec(`CREATE TABLE IF NOT EXISTS entry (key TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS entry_age ON entry(touched, key);
          CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL, clock INTEGER NOT NULL);
          INSERT OR IGNORE INTO totals VALUES (1, 0, 0);
          CREATE TRIGGER IF NOT EXISTS entry_added AFTER INSERT ON entry BEGIN UPDATE totals SET bytes = bytes + new.bytes WHERE id = 1; END;
          CREATE TRIGGER IF NOT EXISTS entry_removed AFTER DELETE ON entry BEGIN UPDATE totals SET bytes = bytes - old.bytes WHERE id = 1; END;
          CREATE TRIGGER IF NOT EXISTS entry_changed AFTER UPDATE OF bytes ON entry BEGIN UPDATE totals SET bytes = bytes + new.bytes - old.bytes WHERE id = 1; END;
          CREATE TABLE IF NOT EXISTS reach_index (id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, tree TEXT NOT NULL, generation INTEGER NOT NULL, members TEXT NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS reach_age ON reach_index(touched, id);
          CREATE TABLE IF NOT EXISTS reach_node (idx INTEGER NOT NULL, path TEXT NOT NULL, object TEXT NOT NULL, rank INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(idx, path)) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS reach_edge (idx INTEGER NOT NULL, target TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(idx, target, source)) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS reach_watch (idx INTEGER NOT NULL, key TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(idx, key, file)) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS rest (key TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS rest_age ON rest(touched, key)`);
      }).immediate();
      const pages = db.query<{ page_size: number }, []>('PRAGMA page_size').get()!.page_size;
      db.exec(`PRAGMA max_page_count = ${Math.max(8, Math.floor(budget / pages))}`);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  };
  let db: Database;
  try {
    db = open();
  } catch (error) {
    if (!damaged(error)) throw error;
    degrade(error);
    reset();
    db = open();
  }
  let reader: Database | undefined;
  let rounds = 0;
  const reopen = (): void => {
    reader?.close();
    reader = undefined;
    db.close();
    reset();
    db = open();
  };
  const safely = <A>(work: () => A, absent: A): A => {
    try {
      return work();
    } catch (error) {
      if (damaged(error)) {
        degrade(error);
        reopen();
        return absent;
      }
      const code = codeOf(error);
      if (code !== undefined && (code.startsWith('SQLITE_') || ['EACCES', 'EIO', 'ENOSPC', 'EROFS'].includes(code))) {
        degrade(error);
        return absent;
      }
      throw error;
    }
  };
  const full = (error: unknown): boolean => error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_FULL';
  const evict = (id: number): void => {
    for (const table of ['reach_node', 'reach_edge', 'reach_watch']) db.query(`DELETE FROM ${table} WHERE idx = ?`).run(id);
    db.query('DELETE FROM reach_index WHERE id = ?').run(id);
  };
  const oldest = (kept: string, wanted: number): readonly Aged[] => {
    const statements = [
      db.prepare<Aged, [string]>(`SELECT 'entry' AS source, key, bytes, touched FROM entry WHERE key != ? ORDER BY touched, key`),
      db.prepare<Aged, [string]>(
        `SELECT 'reach' AS source, CAST(id AS TEXT) AS key, bytes, touched FROM reach_index WHERE key != ? ORDER BY touched, id`,
      ),
      db.prepare<Aged, [string]>(`SELECT 'rest' AS source, key, bytes, touched FROM rest WHERE key != ? ORDER BY touched, key`),
    ];
    const sources = statements.map((statement) => statement.iterate(kept));
    const heads = sources.map((rows) => rows.next());
    const chosen: Aged[] = [];
    try {
      for (let freed = 0; freed < wanted;) {
        let at = -1;
        for (const [index, head] of heads.entries())
          if (!head.done && (at === -1 || head.value.touched < (heads[at]!.value as Aged).touched)) at = index;
        if (at === -1) break;
        const row = heads[at]!.value as Aged;
        chosen.push(row);
        freed += Math.max(1, row.bytes);
        heads[at] = sources[at]!.next();
      }
    } finally {
      for (const statement of statements) statement.finalize();
    }
    return chosen;
  };
  const giveWay = (kept: string): boolean =>
    db
      .transaction((): boolean => {
        const chosen = oldest(kept, budget / 8);
        for (const one of chosen) {
          if (one.source === 'entry') db.query('DELETE FROM entry WHERE key = ?').run(one.key);
          else if (one.source === 'reach') evict(Number(one.key));
          else db.query('DELETE FROM rest WHERE key = ?').run(one.key);
        }
        return chosen.length > 0;
      })
      .immediate();
  const roomy = <A>(write: () => A, kept = ''): A => {
    for (;;) {
      try {
        return write();
      } catch (error) {
        if (!full(error) || !giveWay(kept)) throw error;
      }
    }
  };
  const staging = Math.min(budget / 16, 16 * 1024 * 1024);
  const writes = cacheWrites<Row & { readonly bytes: number }>(staging, (key, row) => Buffer.byteLength(key) + (row?.bytes ?? 0));
  const drop = (key: string): void => {
    db.query('DELETE FROM entry WHERE key = ?').run(key);
  };
  let flushes = 0;
  const recent = new Map<string, number>();
  const touch = (key: string): void => {
    const last = recent.get(key);
    if (last !== undefined && flushes - last < TOUCH_WINDOW) return;
    if (recent.size >= TOUCHES_KEPT) recent.clear();
    recent.set(key, flushes);
    if (writes.bytes() + Buffer.byteLength(key) > staging) flush();
    writes.touch(key);
  };
  const get = (key: string): Row | undefined =>
    safely(() => {
      const row = writes.get(key) ?? db.query<Row, [string]>('SELECT body, digest FROM entry WHERE key = ?').get(key);
      if (row == null) return undefined;
      touch(key);
      return row;
    }, undefined);
  const set = (key: string, value: unknown): number | undefined => {
    const body = JSON.stringify(value),
      digest = recordDigest(key, body);
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(body) + digest.length;
    if (bytes > budget / 2 || bytes + Buffer.byteLength(key) > staging) return undefined;
    if (writes.bytes() + bytes + Buffer.byteLength(key) > staging) flush();
    writes.set(key, { body, digest, bytes });
    return body.length;
  };
  const flush = (): void => {
    flushes += 1;
    const pending = writes.drain();
    if (opened.size > 0) {
      const keys = [...opened];
      opened.clear();
      safely(
        () =>
          db
            .transaction(() => {
              const clock = tick();
              for (const key of keys) db.query('UPDATE reach_index SET touched = ? WHERE key = ?').run(clock, key);
            })
            .immediate(),
        undefined,
      );
    }
    if (pending.length === 0) return;
    safely(
      () =>
        roomy(() =>
          db
            .transaction(() => {
              const clock = tick();
              const stored = db.query<{ digest: string; bytes: number }, [string]>('SELECT digest, bytes FROM entry WHERE key = ?');
              const touched: string[] = [];
              const written: [string, Row & { readonly bytes: number }, number][] = [];
              for (const [key, row] of pending) {
                const held = row === undefined ? null : stored.get(key);
                if (row === undefined || (held !== null && (held.digest === row.digest || key.startsWith('parse:')))) touched.push(key);
                else written.push([key, row, held?.bytes ?? 0]);
              }
              if (touched.length > 0)
                db.query('UPDATE entry SET touched = ? WHERE key IN (SELECT value FROM json_each(?))').run(clock, JSON.stringify(touched));
              for (const [key, , replaced] of written) if (replaced > 0) drop(key);
              let used = db.query<{ bytes: number }, []>('SELECT bytes FROM totals WHERE id = 1').get()!.bytes;
              for (const [key, row] of written) {
                while (used + row.bytes > budget / 2) {
                  const oldest = db
                    .query<{ key: string; bytes: number }, []>('SELECT key, bytes FROM entry ORDER BY touched, key LIMIT 1')
                    .get();
                  if (oldest === null) break;
                  drop(oldest.key);
                  used -= oldest.bytes;
                }
                db.query('INSERT INTO entry (key, body, digest, bytes, touched) VALUES (?, ?, ?, ?, ?)').run(
                  key,
                  row.body,
                  row.digest,
                  row.bytes,
                  clock,
                );
                used += row.bytes;
              }
            })
            .immediate(),
        ),
      undefined,
    );
  };
  const opened = new Set<string>();
  const tick = (): number => {
    db.exec('UPDATE totals SET clock = clock + 1 WHERE id = 1');
    return db.query<{ clock: number }, []>('SELECT clock FROM totals WHERE id = 1').get()!.clock;
  };
  const reading = (): Database => {
    if (reader === undefined) {
      reader = new Database(path);
      reader.exec('PRAGMA busy_timeout = 1000');
      reader.exec('PRAGMA query_only = 1');
    }
    return reader;
  };
  const read = <A>(work: (on: Database) => A): A => {
    try {
      return work(reading());
    } catch (error) {
      if (damaged(error)) reopen();
      throw error;
    }
  };
  const round = <A>(work: () => A): A => {
    const on = read((one) => one);
    if (rounds++ === 0) on.exec('BEGIN');
    try {
      return work();
    } finally {
      if (--rounds === 0 && reader?.inTransaction === true) reader.exec('COMMIT');
    }
  };
  const weigh = (path: string, object: string, body: string, out: readonly string[], watch: readonly string[]): number => {
    let bytes = Buffer.byteLength(path) + Buffer.byteLength(object) + Buffer.byteLength(body) + 16;
    for (const target of out) bytes += Buffer.byteLength(target) + Buffer.byteLength(path) + 8;
    for (const key of watch) bytes += Buffer.byteLength(key) + Buffer.byteLength(path) + 8;
    return bytes;
  };
  const tooLarge = new Error('reach-too-large');
  const taken = new Error('reach-key-taken');
  const advance = <N, M>(
    key: string,
    from: ReachHead | undefined,
    to: string,
    delta: ReachDelta<N>,
    members: M,
    rebuild: boolean,
  ): ReachApplied =>
    db
      .transaction((): ReachApplied => {
        const at = db
          .query<IndexRow & { bytes: number }, [string]>('SELECT id, tree, generation, members, bytes FROM reach_index WHERE key = ?')
          .get(key);
        if (from === undefined ? at !== null : at === null || at.tree !== from.tree || at.generation !== from.generation) return 'moved';
        const clock = tick();
        const held = JSON.stringify(members);
        const meta = (tree: string, text: string): number => Buffer.byteLength(key) + Buffer.byteLength(text) + Buffer.byteLength(tree);
        let id: number, bytes: number;
        if (at === null || rebuild) {
          if (at !== null) evict(at.id);
          try {
            id = Number(
              db
                .query('INSERT INTO reach_index (key, tree, generation, members, bytes, touched) VALUES (?, ?, ?, ?, 0, ?)')
                .run(key, to, clock, held, clock).lastInsertRowid,
            );
          } catch (error) {
            throw error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
              ? taken
              : error;
          }
          bytes = 0;
        } else {
          id = at.id;
          bytes = at.bytes - meta(at.tree, at.members);
        }
        for (const [path, node] of delta.nodes) {
          const old = db
            .query<NodeRow, [number, string]>('SELECT object, rank, body FROM reach_node WHERE idx = ? AND path = ?')
            .get(id, path);
          if (old !== null) {
            const body = JSON.parse(old.body) as Body<unknown>;
            for (const target of body.out)
              db.query('DELETE FROM reach_edge WHERE idx = ? AND target = ? AND source = ?').run(id, target, path);
            for (const watch of body.watch) db.query('DELETE FROM reach_watch WHERE idx = ? AND key = ? AND file = ?').run(id, watch, path);
            db.query('DELETE FROM reach_node WHERE idx = ? AND path = ?').run(id, path);
            bytes -= weigh(path, old.object, old.body, body.out, body.watch);
          }
          if (node === null) continue;
          const body = JSON.stringify({ out: node.out, watch: node.watch, note: node.note } satisfies Body<N>);
          db.query('INSERT INTO reach_node (idx, path, object, rank, body) VALUES (?, ?, ?, ?, ?)').run(
            id,
            path,
            node.object,
            node.rank,
            body,
          );
          for (const target of node.out)
            db.query('INSERT OR IGNORE INTO reach_edge (idx, target, source) VALUES (?, ?, ?)').run(id, target, path);
          for (const watch of node.watch)
            db.query('INSERT OR IGNORE INTO reach_watch (idx, key, file) VALUES (?, ?, ?)').run(id, watch, path);
          bytes += weigh(path, node.object, body, node.out, node.watch);
        }
        const total = bytes + meta(to, held);
        if (total > budget / 2) throw tooLarge;
        db.query('UPDATE reach_index SET tree = ?, generation = ?, members = ?, bytes = ?, touched = ? WHERE id = ?').run(
          to,
          clock,
          held,
          total,
          clock,
          id,
        );
        for (;;) {
          const used = db.query<{ used: number }, []>('SELECT COALESCE(SUM(bytes), 0) AS used FROM reach_index').get()!.used;
          if (used <= budget / 2) break;
          const oldest = db
            .query<{ id: number }, [number]>('SELECT id FROM reach_index WHERE id != ? ORDER BY touched, id LIMIT 1')
            .get(id);
          if (oldest === null) break;
          evict(oldest.id);
        }
        return 'applied';
      })
      .immediate();
  const reach: ReachTable & { readonly round: <A>(work: () => A) => A } = {
    open: <N, M>(key: string): ReachView<N, M> => {
      opened.add(key);
      let row: IndexRow | null | undefined;
      let held: M | undefined;
      const index = (): IndexRow | null =>
        row === undefined
          ? (row = read((on) =>
              on.query<IndexRow, [string]>('SELECT id, tree, generation, members FROM reach_index WHERE key = ?').get(key),
            ))
          : row;
      return {
        get head() {
          const at = index();
          return at === null ? undefined : { tree: at.tree, generation: at.generation };
        },
        get members() {
          const at = index();
          return at === null ? undefined : (held ??= JSON.parse(at.members) as M);
        },
        node: (path) => {
          const at = index();
          if (at === null) return undefined;
          const found = read((on) =>
            on.query<NodeRow, [number, string]>('SELECT object, rank, body FROM reach_node WHERE idx = ? AND path = ?').get(at.id, path),
          );
          if (found === null) return undefined;
          const body = JSON.parse(found.body) as Body<N>;
          return { object: found.object, rank: found.rank, out: body.out, watch: body.watch, note: body.note };
        },
        sources: (path) => {
          const at = index();
          return at === null
            ? []
            : read((on) =>
                on
                  .query<{ source: string }, [number, string]>('SELECT source FROM reach_edge WHERE idx = ? AND target = ?')
                  .all(at.id, path),
              ).map((one) => one.source);
        },
        watchers: (watch) => {
          const at = index();
          return at === null
            ? []
            : read((on) =>
                on.query<{ file: string }, [number, string]>('SELECT file FROM reach_watch WHERE idx = ? AND key = ?').all(at.id, watch),
              ).map((one) => one.file);
        },
      };
    },
    apply: (key, from, to, delta, members, rebuild = false) =>
      safely(
        () =>
          roomy((): ReachApplied => {
            try {
              return advance(key, from, to, delta, members, rebuild);
            } catch (error) {
              if (error === tooLarge) return 'full';
              if (error === taken) return 'moved';
              throw error;
            }
          }, key),
        'full',
      ),
    round,
  };
  class Parses extends Map<string, readonly ImportSite[]> {
    override get(key: string): readonly ImportSite[] | undefined {
      const held = super.get(key);
      if (held !== undefined) {
        touch(`parse:${key}`);
        return held;
      }
      const name = `parse:${key}`,
        row = get(name);
      if (row === undefined) return undefined;
      const value = readCacheRecord('parse', name, row.body, row.digest);
      if (value === undefined) safely(() => drop(name), undefined);
      else super.set(key, value);
      return value;
    }
    override has(key: string): boolean {
      return this.get(key) !== undefined;
    }
    override set(key: string, value: readonly ImportSite[]): this {
      set(`parse:${key}`, value);
      return super.set(key, value);
    }
  }
  const parses: ParseMemo = new Parses();
  const decodedCapacity = Math.floor(totalmem() / 1024);
  const decoded = new Map<string, { readonly value: MemoValue; readonly bytes: number }>();
  let decodedBytes = 0;
  const hold = (key: string, value: MemoValue, bytes: number): void => {
    const held = decoded.get(key);
    if (held !== undefined) {
      decoded.delete(key);
      decodedBytes -= held.bytes;
    }
    if (bytes > decodedCapacity) return;
    decoded.set(key, { value, bytes });
    decodedBytes += bytes;
    for (const [oldest, one] of decoded) {
      if (decodedBytes <= decodedCapacity) break;
      decoded.delete(oldest);
      decodedBytes -= one.bytes;
    }
  };
  const memo: InspectionMemo = {
    get: (key) => {
      const name = `memo:${key}`;
      const held = decoded.get(name);
      if (held !== undefined) {
        decoded.delete(name);
        decoded.set(name, held);
        touch(name);
        return held.value;
      }
      const row = get(name);
      if (row === undefined) return undefined;
      const value = readCacheRecord('memo', name, row.body, row.digest);
      if (value === undefined) safely(() => drop(name), undefined);
      else hold(name, value, row.body.length);
      return value;
    },
    set: (key, value: MemoValue) => {
      const name = `memo:${key}`;
      const bytes = set(name, value);
      if (bytes !== undefined) hold(name, value, bytes);
    },
  };
  const calibration = {
    get: (builtin: string): CalibrationRecord | undefined => {
      const name = calibrationKeyOf(builtin);
      const row = get(name);
      if (row === undefined) return undefined;
      const value = readCalibrationRecord(name, row.body, row.digest);
      if (value === undefined) safely(() => drop(name), undefined);
      return value;
    },
    set: (builtin: string, value: Calibration): void => {
      set(calibrationKeyOf(builtin), {
        builtin,
        cbMsPerFile: value.cbMsPerFile,
        dbMsPerMib: value.dbMsPerMib,
        probeMs: value.probeMs,
        probeFiles: value.probeFiles,
        probeMib: value.probeMib,
        measuredAt: Date.now(),
      } satisfies CalibrationRecord);
    },
  };
  const rest = {
    get: (key: string): unknown =>
      safely(() => {
        const row = db.query<Row, [string]>('SELECT body, digest FROM rest WHERE key = ?').get(key);
        if (row === null || row.digest !== recordDigest(key, row.body)) return undefined;
        try {
          return JSON.parse(row.body) as unknown;
        } catch {
          return undefined;
        }
      }, undefined),
    set: (key: string, value: unknown): void => {
      const body = JSON.stringify(value);
      safely(() => {
        if (Buffer.byteLength(body) > budget / 4) db.query('DELETE FROM rest WHERE key = ?').run(key);
        else
          roomy(
            () =>
              db
                .transaction(() =>
                  db
                    .query('INSERT OR REPLACE INTO rest (key, body, digest, bytes, touched) VALUES (?, ?, ?, ?, ?)')
                    .run(key, body, recordDigest(key, body), Buffer.byteLength(key) + Buffer.byteLength(body), tick()),
                )
                .immediate(),
            key,
          );
      }, undefined);
    },
  };
  return {
    parses,
    memo,
    calibration,
    reach,
    rest,
    budget,
    flush,
    close: () => {
      flush();
      reader?.close();
      reader = undefined;
      db.close();
    },
  };
}
