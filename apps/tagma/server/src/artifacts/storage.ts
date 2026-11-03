import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { Result, Schema } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CURRENT } from '../platform/contract/wire/versions.js';
import {
  currentVersion,
  nextVersion,
  openVersion,
  readCurrentFile,
  swapCurrent,
  versionsNewestFirst,
} from '../platform/lock/versionedDirectories.js';
import { pruneVersions } from '../platform/lock/versionLeases.js';
import type { Draft, KeptVideo, PageVideos, PublishPage, ShelfKey, ShelfPage, ShelfSelection } from './contract/service/shelf.js';
import type { CompactionFailure, Published, SelectionUpdate } from './protocol.js';
import { Selection } from './selection.js';
import {
  ARTIFACT_ID,
  artifactManifestSchema,
  type ArtifactManifest,
  type ArtifactPage,
  type ArtifactRecord,
  type ShelfState,
  type ThreadPages,
  VIDEO_FILE,
  type VideoScale,
} from './contract/wire/artifacts.js';
import { declaredTimeline } from './declaration.js';
import { frameCount } from './contract/wire/timeline.js';
import {
  admits,
  compacts,
  retryAfter,
  supersededCeiling,
  decodeRecord,
  encodeRecord,
  type OrderLog,
  type OrderRecord,
  RECORD_BYTES,
  walk,
  type Walked,
} from './order.js';

function artifactId(sourcePath: string): string {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 12);
}

function pageFile(path: string, act: 'publish' | 'draw'): { readonly sourcePath: string; readonly html: string } {
  const sourcePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!existsSync(sourcePath)) {
    throw new GateRefusal('no-such-page', `nothing to ${act} at ${sourcePath}`, [
      `write the page to that path first — the tool ${act === 'publish' ? 'publishes' : 'draws'} a file, it does not take markup`,
    ]);
  }
  const html = readFileSync(sourcePath, 'utf8');
  if (html.trim().length === 0) {
    throw new GateRefusal('empty-page', `the file at ${sourcePath} is empty`, [
      act === 'publish' ? 'write the page before publishing it' : 'write the page before drawing it',
    ]);
  }
  return { sourcePath, html };
}

const PAGE = 'page.html';
const MANIFEST = 'artifact.json';
const SIDECAR = 'order';
const HEAD = 'order.head';
const THREADS = 'threads';

const KEPT_VERSIONS = 20;

const TITLE_WINDOW = 8192;

const readManifest = Schema.decodeUnknownResult(artifactManifestSchema);

const headSchema = Schema.Struct({ epoch: Schema.Int, confirmed: Schema.Int, live: Schema.Int });
const readHead = Schema.decodeUnknownResult(headSchema);
type Head = typeof headSchema.Type;
type ThreadClaims = { readonly thread: string; readonly ids: Set<string> };

const staleCursor = () =>
  new GateRefusal(
    'cursor-stale',
    'the shelf was compacted or rebuilt, or a version this walk needs was pruned, since this cursor was minted',
    ['ask again with no cursor to open a new walk'],
  );

export class VersionedShelf {
  private head: Head | null = null;
  private compactAt = 0;
  private readonly following = new Map<number, Selection>();

  constructor(
    private readonly root: string,
    private readonly origin: string,
  ) {}

  publish(input: PublishPage, now: () => number): Published {
    const { sourcePath, html } = pageFile(input.path, 'publish');
    const title = input.title?.trim() || titleOf(html) || 'Untitled';
    const declared = declaredTimeline(html);
    const id = artifactId(sourcePath);
    const home = join(this.root, id);
    let head = this.opened();
    let prev = this.sidecar(id, head.epoch);
    if (prev === 'broken' || (prev === null && currentVersion(home) !== null)) {
      head = this.rebuild();
      prev = this.sidecar(id, head.epoch);
    }
    if (!admits(head.confirmed, head.live, typeof prev !== 'number')) {
      const recovered = this.recover(head);
      if (typeof recovered === 'string') throw this.unavailable(head, recovered);
      head = recovered;
      prev = this.sidecar(id, head.epoch);
    }
    const previous = typeof prev === 'number' ? prev : -1;
    mkdirSync(home, { recursive: true });
    const at = now();
    const version = nextVersion(home, new Date(at));
    const manifest: ArtifactManifest = {
      id,
      title,
      description: input.description?.trim() || null,
      sourcePath,
      publishedAt: new Date(at).toISOString(),
      timeline: declared.timeline,
    };
    const target = openVersion(home, version);
    writeFileSync(join(target, PAGE), html);
    writeFileSync(join(target, MANIFEST), `${JSON.stringify(manifest)}\n`);
    const seq = head.confirmed;
    const kept = versionsNewestFirst(home).slice(0, KEPT_VERSIONS);
    this.append(head.epoch, { id, version, prev: previous, versions: kept.length });
    this.writeSidecar(id, head.epoch, seq);
    swapCurrent(home, version);
    pruneVersions(home, kept);
    const settled = this.saveHead({ epoch: head.epoch, confirmed: seq + 1, live: head.live + (previous < 0 ? 1 : 0) });
    const record = this.recorded(manifest, version, kept.length);
    this.claim(input.thread, id);
    const updates: SelectionUpdate[] = [];
    for (const [id, selected] of this.following)
      if (selected.publish(input.thread, record)) updates.push({ id, value: selected.snapshot() });
    return {
      record,
      kept,
      timelineProblem: declared.problem,
      updates,
      maintenance: compacts(settled.confirmed, settled.live, this.compactAt) ? { records: settled.confirmed, live: settled.live } : null,
    };
  }

  draft(path: string): Draft {
    const { sourcePath, html } = pageFile(path, 'draw');
    const declared = declaredTimeline(html);
    return { id: artifactId(sourcePath), html, timeline: declared.timeline, timelineProblem: declared.problem };
  }

  maintain(): CompactionFailure | null {
    const head = this.opened();
    if (!compacts(head.confirmed, head.live, this.compactAt)) return null;
    try {
      this.compact(head);
      return null;
    } catch (failure) {
      return { recovered: this.compactionFailed(head), failure: String(failure) };
    }
  }

  list(request: ShelfSelection): ShelfPage {
    const read = this.read(request.after ?? null, request.limit);
    if (read === 'stale') throw staleCursor();
    return read;
  }

  page(id: string, version?: string): ArtifactPage | null {
    const home = join(this.root, id);
    const record = version === undefined ? this.current(id) : this.at(id, version);
    if (record === null) return null;
    try {
      return { record, html: readFileSync(join(home, record.version, PAGE), 'utf8') };
    } catch {
      return null;
    }
  }

  versions(id: string): readonly string[] {
    return versionsNewestFirst(join(this.root, id));
  }

  state(id: string): ShelfState {
    return { current: this.current(id), kept: this.versions(id) };
  }

  videos(id: string): PageVideos {
    const home = join(this.root, id);
    const kept: KeptVideo[] = [];
    const parts: string[] = [];
    for (const version of this.versions(id)) {
      let names: string[];
      try {
        names = readdirSync(join(home, version));
      } catch {
        continue;
      }
      const timeline = names.some((name) => VIDEO_FILE.test(name)) ? decode(readFile(join(home, version, MANIFEST)))?.timeline : null;
      for (const name of names) {
        if (name.endsWith('.mp4.part') && VIDEO_FILE.test(name.slice(0, -'.part'.length))) parts.push(join(home, version, name));
        const named = VIDEO_FILE.exec(name);
        if (named === null || timeline === undefined || timeline === null) continue;
        const bytes = statSync(join(home, version, name), { throwIfNoEntry: false })?.size;
        if (bytes !== undefined)
          kept.push({ version, fps: Number(named[1]), scale: Number(named[2]) as VideoScale, frames: frameCount(timeline), bytes });
      }
    }
    return { kept, parts };
  }

  pages(threads: readonly string[], limit: number): ThreadPages {
    return this.select(threads, limit).snapshot();
  }

  follow(id: number, threads: readonly string[], limit: number): ThreadPages {
    const selected = this.select(threads, limit);
    this.following.set(id, selected);
    return selected.snapshot();
  }

  unfollow(id: number): null {
    this.following.delete(id);
    return null;
  }

  private select(threads: readonly string[], limit: number): Selection {
    const selected = new Selection(threads, limit);
    for (const thread of selected.threads)
      for (const id of this.claimed(thread)) selected.include(thread, id, selected.has(id) ? null : this.current(id));
    return selected;
  }

  private claims: ThreadClaims | null = null;

  private claimed(thread: string): Set<string> {
    if (this.claims?.thread === thread) return this.claims.ids;
    const held = readFile(this.claimPath(thread));
    return new Set(held === null ? [] : held.split('\n').filter((id) => ARTIFACT_ID.test(id)));
  }

  private claim(thread: string, id: string): void {
    const claimed = this.claimed(thread);
    this.claims = { thread, ids: claimed };
    if (claimed.has(id)) return;
    mkdirSync(join(this.root, THREADS), { recursive: true });
    appendFileSync(this.claimPath(thread), `${id}\n`);
    claimed.add(id);
  }

  private claimPath(thread: string): string {
    return join(this.root, THREADS, createHash('sha256').update(thread).digest('hex').slice(0, 24));
  }

  private read(after: ShelfKey | null, limit: number): ShelfPage | 'stale' {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const head = this.opened();
      const walked = this.walked(head, after, limit);
      if (walked === 'stale') return 'stale';
      if (walked !== 'broken') {
        const rows = this.rows(walked.rows, after === null);
        if (rows === 'stale') return 'stale';
        if (rows !== 'broken') return { rows, total: after?.total ?? head.live, more: walked.more };
      }
      this.rebuild();
      if (after !== null) return 'stale';
    }
    throw new Error(`the artifact order index under ${this.root} disagrees with the shelf right after a rebuild`);
  }

  private walked(head: Head, after: ShelfKey | null, limit: number) {
    const log = this.logReader(head);
    try {
      const walked = walk(log.log, after, limit);
      return walked.kind === 'rows' ? walked : walked.kind;
    } finally {
      log.close();
    }
  }

  private rows(walked: readonly Walked[], fresh: boolean) {
    const rows: { readonly record: ArtifactRecord; readonly key: ShelfKey }[] = [];
    for (const row of walked) {
      const home = join(this.root, row.id);
      if (fresh && currentVersion(home) !== row.version) return 'broken';
      const manifest = decode(readFile(join(home, row.version, MANIFEST)));
      if (manifest === null) return fresh ? 'broken' : 'stale';
      rows.push({ record: this.recorded(manifest, row.version, row.versions), key: row.key });
    }
    return rows;
  }

  private opened(): Head {
    if (this.head !== null) return this.head;
    mkdirSync(this.root, { recursive: true });
    const saved = decodeHead(readFile(join(this.root, HEAD)));
    if (saved === null) return this.rebuild();
    const log = this.logPath(saved.epoch);
    if (!existsSync(log) || existsSync(this.logPath(saved.epoch + 1))) return this.rebuild();
    rmSync(this.logPath(saved.epoch - 1), { force: true });
    const size = statSync(log).size;
    const records = Math.floor(size / RECORD_BYTES);
    if (records < saved.confirmed) return this.rebuild();
    if (size !== records * RECORD_BYTES) truncateSync(log, records * RECORD_BYTES);
    if (records === saved.confirmed) {
      this.head = saved;
      return saved;
    }
    return this.settleTail(saved, records);
  }

  private settleTail(saved: Head, records: number): Head {
    let live = saved.live;
    const reader = this.logReader({ ...saved, confirmed: records });
    try {
      const tail = reader.log.records(saved.confirmed, records);
      for (const [offset, record] of tail.entries()) {
        if (record === null) return this.rebuild();
        const seq = saved.confirmed + offset;
        if (currentVersion(join(this.root, record.id)) === record.version) {
          this.writeSidecar(record.id, saved.epoch, seq);
          if (record.prev < 0) live += 1;
        } else if (record.prev >= 0) {
          this.writeSidecar(record.id, saved.epoch, record.prev);
        } else {
          rmSync(join(this.root, record.id, SIDECAR), { force: true });
        }
      }
    } finally {
      reader.close();
    }
    return this.saveHead({ epoch: saved.epoch, confirmed: records, live });
  }

  private rebuild(): Head {
    mkdirSync(this.root, { recursive: true });
    const entries = readdirSync(this.root, { withFileTypes: true });
    const logs = entries.filter((entry) => entry.isFile() && /^order\.\d+\.log$/.test(entry.name)).map((entry) => entry.name);
    const epoch = 1 + Math.max(this.head?.epoch ?? 0, ...logs.map((name) => Number(name.split('.')[1])));
    const standing: { readonly id: string; readonly version: string; readonly versions: number; readonly publishedAt: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !ARTIFACT_ID.test(entry.name)) continue;
      const home = join(this.root, entry.name);
      const version = currentVersion(home);
      const manifest = version === null ? null : decode(readCurrentFile(home, MANIFEST));
      if (version === null || manifest === null) {
        rmSync(join(home, SIDECAR), { force: true });
        continue;
      }
      standing.push({
        id: entry.name,
        version,
        versions: Math.min(KEPT_VERSIONS, Math.max(1, versionCount(home))),
        publishedAt: manifest.publishedAt,
      });
    }
    standing.sort((left, right) =>
      left.publishedAt === right.publishedAt ? (left.id < right.id ? 1 : -1) : left.publishedAt < right.publishedAt ? -1 : 1,
    );
    return this.replaceLog(
      epoch,
      standing.map((row) => ({ id: row.id, version: row.version, prev: -1, versions: row.versions })),
      logs,
    );
  }

  private compact(head: Head): void {
    const reader = this.logReader(head);
    try {
      this.replaceLog(head.epoch + 1, this.liveRecords(head, reader.log), [`order.${head.epoch}.log`]);
    } finally {
      reader.close();
    }
  }

  private recover(head: Head): Head | string {
    try {
      this.compact(head);
      return this.opened();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      return this.compactionFailed(head) ? this.opened() : detail;
    }
  }

  private unavailable(head: Head, failure: string): GateRefusal<'artifact-index-unavailable'> {
    const log = this.logPath(head.epoch);
    return new GateRefusal(
      'artifact-index-unavailable',
      `the publish-order index ${log} holds ${head.confirmed - head.live} superseded records, and one more would pass its bound of ${supersededCeiling(head.live)}; compacting it failed: ${failure}`,
      [
        `make ${this.root} writable with room for a copy of ${log}, then publish again — the next publish retries the compaction`,
        `or delete ${join(this.root, HEAD)} so the shelf rebuilds the index from its pages`,
      ],
    );
  }

  private compactionFailed(settled: Head): boolean {
    this.compactAt = retryAfter(settled.confirmed, settled.live);
    this.head = null;
    try {
      rmSync(this.logPath(settled.epoch + 1), { force: true });
      if (this.opened().epoch === settled.epoch) this.rebuild();
      return true;
    } catch {
      this.head = null;
      return false;
    }
  }

  private *liveRecords(head: Head, log: OrderLog): Generator<OrderRecord> {
    for (let from = 0; from < head.confirmed; from += COMPACT_CHUNK) {
      const chunk = log.records(from, Math.min(head.confirmed, from + COMPACT_CHUNK));
      for (const [offset, record] of chunk.entries()) {
        if (record !== null && log.head(record.id) === from + offset) yield { ...record, prev: -1 };
      }
    }
  }

  private replaceLog(epoch: number, records: Iterable<OrderRecord>, retired: readonly string[]): Head {
    const path = this.logPath(epoch);
    const fd = openSync(path, 'w');
    let written = 0;
    try {
      const batch = Buffer.alloc(COMPACT_CHUNK * RECORD_BYTES);
      let held = 0;
      for (const record of records) {
        batch.write(encodeRecord(record), held * RECORD_BYTES, 'latin1');
        this.writeSidecar(record.id, epoch, written);
        written += 1;
        held += 1;
        if (held === COMPACT_CHUNK) {
          writeSync(fd, batch, 0, held * RECORD_BYTES);
          held = 0;
        }
      }
      if (held > 0) writeSync(fd, batch, 0, held * RECORD_BYTES);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const head = this.saveHead({ epoch, confirmed: written, live: written });
    for (const name of retired) if (name !== `order.${epoch}.log`) rmSync(join(this.root, name), { force: true });
    return head;
  }

  private append(epoch: number, record: OrderRecord): void {
    const fd = openSync(this.logPath(epoch), 'a');
    try {
      writeSync(fd, encodeRecord(record));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private logReader(head: Head): { readonly log: OrderLog; readonly close: () => void } {
    let fd: number | null = null;
    const records = (from: number, to: number): (OrderRecord | null)[] => {
      if (to <= from) return [];
      fd ??= openSync(this.logPath(head.epoch), 'r');
      const bytes = Buffer.alloc((to - from) * RECORD_BYTES);
      const got = readSync(fd, bytes, 0, bytes.length, from * RECORD_BYTES);
      const text = bytes.toString('latin1', 0, got);
      return Array.from({ length: to - from }, (_, at) => decodeRecord(text.slice(at * RECORD_BYTES, (at + 1) * RECORD_BYTES)));
    };
    return {
      log: { epoch: head.epoch, confirmed: head.confirmed, live: head.live, records, head: (id) => this.sidecar(id, head.epoch) },
      close: () => {
        if (fd !== null) closeSync(fd);
      },
    };
  }

  private sidecar(id: string, epoch: number): number | null | 'broken' {
    const held = readFile(join(this.root, id, SIDECAR));
    if (held === null) return null;
    const match = /^(\d+) (\d+)\n$/.exec(held);
    if (match === null || Number(match[1]) !== epoch) return 'broken';
    return Number(match[2]);
  }

  private writeSidecar(id: string, epoch: number, seq: number): void {
    const path = join(this.root, id, SIDECAR);
    writeFileSync(`${path}.pending`, `${epoch} ${seq}\n`);
    renameSync(`${path}.pending`, path);
  }

  private saveHead(head: Head): Head {
    const path = join(this.root, HEAD);
    writeFileSync(`${path}.pending`, `${JSON.stringify(head)}\n`);
    renameSync(`${path}.pending`, path);
    this.head = head;
    return head;
  }

  private logPath(epoch: number): string {
    return join(this.root, `order.${epoch}.log`);
  }

  private current(id: string): ArtifactRecord | null {
    const home = join(this.root, id);
    const manifest = decode(readCurrentFile(home, MANIFEST));
    const version = currentVersion(home);
    if (manifest === null || version === null) return null;
    return this.recorded(manifest, version, versionsNewestFirst(home).length);
  }

  private at(id: string, version: string): ArtifactRecord | null {
    const home = join(this.root, id);
    const manifest = decode(readFile(join(home, version, MANIFEST)));
    if (manifest === null) return null;
    return this.recorded(manifest, version, versionsNewestFirst(home).length);
  }

  private recorded(manifest: ArtifactManifest, version: string, versions: number): ArtifactRecord {
    return { ...manifest, timeline: manifest.timeline ?? null, version, versions, url: `${this.origin}/a/${manifest.id}` };
  }
}

const COMPACT_CHUNK = 4096;

function versionCount(home: string): number {
  try {
    return readdirSync(home, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== CURRENT).length;
  } catch {
    return 0;
  }
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, TITLE_WINDOW));
  const named = match?.[1]?.trim();
  return named ? named : null;
}

function decodeHead(held: string | null): Head | null {
  if (held === null) return null;
  try {
    const decoded = readHead(JSON.parse(held));
    if (Result.isFailure(decoded)) {
      console.warn('[tagma] a page head does not read as one', decoded.failure.message);
      return null;
    }
    return decoded.success;
  } catch {
    return null;
  }
}

function decode(held: string | null): ArtifactManifest | null {
  if (held === null) return null;
  try {
    const decoded = readManifest(JSON.parse(held));
    if (Result.isFailure(decoded)) {
      console.warn('[tagma] a page manifest does not read as one', decoded.failure.message);
      return null;
    }
    return decoded.success;
  } catch {
    return null;
  }
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
