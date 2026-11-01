import { Effect, type Context, type FileSystem } from 'effect';
import { renamedFromAt } from '@runlith/git/history';
import { blobPrefixAt, fileAt } from '@runlith/git/entries';
import { commitOf, type GitAnswerInvalid, type GitUnreadable } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';
import { PATCH_CONTEXT_LINES } from '@runlith/utils/patch';
import { relative } from 'node:path';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AUTHORSHIP_ANSWER_LINES, type AuthorshipOpen } from '../contract/wire/operations.js';
import type { PathUnreadable } from '../../workspace/contract/service/checkouts.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { confineToTree, type WorkingRootReader } from '../../workspace/roots/proof.js';
import { opensBinary } from '../../workspace/checkouts/weight.js';
import type { AuthoredLine, AuthorshipSide, PathAuthorship } from '../contract/wire/authorship.js';
import type { Authorship, AuthorshipReadRefusal, PathRefused, ReadingFailure } from '../contract/service/authorship.js';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { CommandChanges } from '../contract/service/commands.js';
import type { Holdings } from '../contract/service/holdings.js';
import type { Walks } from '../lines/walks.js';
import type { HolderLines, Placed } from './authored.js';
import { carriesOf } from './carries.js';
import { READING_CAPTURE, refusedByGit } from './failures.js';
import { BINARY_PROBE, looksBinary } from '@runlith/files/content';
import { binary, digestOf, NUL, PAST_BINARY, pastBinary, sameText, type End } from './patch.js';
import { COMMIT_RECORD } from '../changes/commits.js';
import { headBlob, normalizedOne, stagedBlob, working } from './sides.js';
import { entryAt, pastSubmodule, submoduleAnswer, workingSubmodule } from './submodules.js';

const KEPT_BYTES_PER_LINE = 213;

const KEPT_BYTES = 32_000_000;

const APART = Number.MAX_SAFE_INTEGER;

export type AuthorshipReaders = {
  readonly store: Context.Service.Shape<typeof MachineStore>;
  readonly units: MachineUnits['Service'];
  readonly roots: FileRoots['Service'];
  readonly origins: WorkingRootReader;
  readonly git: Git['Service'];
  readonly files: FileSystem.FileSystem;
  readonly graphDirectory: string;
  readonly commands: CommandChanges['Service'];
  readonly walks: Walks;
  readonly holdings: Holdings['Service'];
  readonly names: (threadIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, { readonly name: string | null }>, StoreFailure>;
};

type Half = { readonly answer: PathAuthorship } | { readonly head: { readonly text: End } | null };

type AuthorshipEntry = {
  readonly key: string;
  readonly context: number;
  readonly answer: PathAuthorship;
};

function cutTo(answer: PathAuthorship, context: number): PathAuthorship {
  const lines = answer.lines;
  const reach = lines.map(() => APART);
  let since = APART;
  for (const [at, line] of lines.entries()) {
    if (at > 0 && line.hiddenBefore > 0) since = APART;
    since = line.kind === 'context' ? (since === APART ? APART : since + 1) : 0;
    reach[at] = since;
  }
  let until = APART;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at] as AuthoredLine;
    until = line.kind === 'context' ? (until === APART ? APART : until + 1) : 0;
    if (until < (reach[at] as number)) reach[at] = until;
    if (at > 0 && line.hiddenBefore > 0) until = APART;
  }
  const cut: AuthoredLine[] = [];
  let pending = 0;
  let shown = 0;
  for (const [at, line] of lines.entries()) {
    pending += line.hiddenBefore;
    if ((reach[at] as number) > context) {
      pending += 1;
      continue;
    }
    cut.push(pending === line.hiddenBefore ? line : { ...line, hiddenBefore: pending, hiddenAt: shown + 1 });
    if (line.before !== null) shown = line.before;
    pending = 0;
  }
  return { ...answer, lines: cut };
}

export class AuthorshipCache {
  private readonly authored = new Map<string, AuthorshipEntry>();

  private keptBytes = 0;

  keptAt(at: string, key: string, width: number, opens: readonly AuthorshipOpen[]): PathAuthorship | null {
    const kept = this.authored.get(at);
    if (kept === undefined || kept.key !== key || (opens.length === 0 && kept.context < width)) return null;
    this.keep(at, kept);
    return opens.length > 0 || kept.context === width ? kept.answer : cutTo(kept.answer, width);
  }

  keep(at: string, entry: AuthorshipEntry): void {
    const standing = this.authored.get(at);
    if (standing !== undefined) this.keptBytes -= standing.answer.lines.length * KEPT_BYTES_PER_LINE;
    this.authored.delete(at);
    this.authored.set(at, entry);
    this.keptBytes += entry.answer.lines.length * KEPT_BYTES_PER_LINE;
    for (const [older, dropped] of this.authored) {
      if (this.keptBytes <= KEPT_BYTES) return;
      if (older === at) continue;
      this.authored.delete(older);
      this.keptBytes -= dropped.answer.lines.length * KEPT_BYTES_PER_LINE;
    }
  }

  dropRoot(rootId: RootId): void {
    for (const [at, dropped] of [...this.authored]) {
      if (!at.startsWith(`${rootId}${NUL}`)) continue;
      this.authored.delete(at);
      this.keptBytes -= dropped.answer.lines.length * KEPT_BYTES_PER_LINE;
    }
  }
}

function authorshipOf(
  walks: Walks,
  rootId: RootId,
  path: string,
  base: End,
  bytes: End,
  carries: readonly HolderLines[],
  context: number,
  opens: readonly AuthorshipOpen[],
  limit: number,
  normalized: boolean,
  from: string = path,
): Effect.Effect<Placed, GateRefusal<'record-unread'>> {
  if (pastBinary(base) || pastBinary(bytes) || binary(base) || binary(bytes)) {
    const sides = { before: base === null ? null : from, after: bytes === null ? null : path };
    return Effect.succeed({ answer: { rootId, path, lines: [], binary: true, timedOut: false, sides } });
  }
  return walks
    .authored({ rootId, path, from, base, bytes, carries, context, opens, limit, normalized })
    .pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('record-unread', `the line authorship of ${path} was not walked: ${failure.reason}`, [
            'ask again once the server answers',
          ]),
      ),
    );
}

const endsOf = (
  git: Git['Service'],
  dir: string,
  path: string,
  base: End,
  bytes: End,
): Effect.Effect<boolean, GitUnreadable | GitAnswerInvalid> =>
  normalizedOne(git, dir, path, typeof base === 'string' ? base : null, typeof bytes === 'string' ? bytes : null);

const placedOf = (named: string, placed: Placed): Effect.Effect<PathAuthorship, GateRefusal<AuthorshipReadRefusal>> => {
  if ('gone' in placed) {
    return Effect.fail(
      new GateRefusal(
        'stretch-gone',
        `no hidden run of ${named} stands at line ${placed.gone.at}: this reading shows it already, or the file moved under the answer that named it`,
        ['read the path again and open a run the answer it gives you still hides'],
      ),
    );
  }
  if ('wouldCarry' in placed) {
    return Effect.fail(
      new GateRefusal(
        'context-too-wide',
        `this ask over ${named} answers ${placed.wouldCarry} lines, past the ${AUTHORSHIP_ANSWER_LINES} one reading carries`,
        ['ask again with a narrower context, or open fewer lines'],
      ),
    );
  }
  return Effect.succeed(placed.answer);
};

const blobEnd = (
  git: Git['Service'],
  read: Effect.Effect<string | null, GitUnreadable | GitAnswerInvalid>,
  dir: string,
  revision: string,
  path: string,
): Effect.Effect<End, GitUnreadable | GitAnswerInvalid> =>
  Effect.catchTag(read, 'GitAnswerInvalid', (failure) =>
    Effect.flatMap(blobPrefixAt(actingGit(git, 'thread-files-probe'), dir, revision, path, BINARY_PROBE), (prefix) =>
      prefix !== null && looksBinary(prefix) ? Effect.succeed<End>(PAST_BINARY) : Effect.fail(failure),
    ),
  );

const headEnd = (git: Git['Service'], dir: string, path: string): Effect.Effect<End, GitUnreadable | GitAnswerInvalid> =>
  blobEnd(git, headBlob(git, dir, path), dir, 'HEAD', path);

const workingEnd = (files: FileSystem.FileSystem, dir: string, path: string): Effect.Effect<End, PathUnreadable | PathRefused> =>
  Effect.catchTag(working(files, dir, path), 'PathRefused', (failure) =>
    Effect.flatMap(
      Effect.orElseSucceed(opensBinary(files, `${dir}/${path}`), () => false),
      (opens) => (opens ? Effect.succeed<End>(PAST_BINARY) : Effect.fail(failure)),
    ),
  );

const halfOf = Effect.fn('Authorship.half')(function* (
  git: Git['Service'],
  walks: Walks,
  cache: AuthorshipCache,
  rootId: RootId,
  dir: string,
  named: string,
  side: AuthorshipSide,
  bytes: End,
  width: number,
  opens: readonly AuthorshipOpen[],
  asked: string,
): Effect.fn.Return<Half, ReadingFailure | GateRefusal<AuthorshipReadRefusal>> {
  const index = yield* blobEnd(git, stagedBlob(git, dir, named), dir, '', named);
  if (side === 'staged' && sameText(index, bytes)) return { head: null };
  const head = yield* headEnd(git, dir, named);
  if (side === 'unstaged' && sameText(index, head)) return { head: { text: head } };
  const base = side === 'staged' ? head : index;
  const tip = side === 'staged' ? index : bytes;
  if (base === null && tip === null) {
    return yield* new GateRefusal('not-found', `${named} is a file on neither end of its ${side} half`, [
      'read it without side: this half holds nothing of it',
    ]);
  }
  const at = `${rootId}${NUL}${named}${NUL}${side}${opens.length === 0 ? '' : `${NUL}${asked}`}`;
  const key = `${side}${NUL}${digestOf(base)}${NUL}${digestOf(tip)}`;
  const kept = cache.keptAt(at, key, width, opens);
  if (kept !== null) return { answer: kept };
  const answer = yield* placedOf(
    named,
    yield* authorshipOf(
      walks,
      rootId,
      named,
      base,
      tip,
      [],
      width,
      opens,
      AUTHORSHIP_ANSWER_LINES,
      yield* endsOf(git, dir, named, base, tip),
    ),
  );
  cache.keep(at, { key, context: width, answer });
  return { answer };
});

const committedAuthorship = (
  acting: Git['Service'],
  walks: Walks,
  cache: AuthorshipCache,
  rootId: RootId,
  dir: string,
  named: string,
  commit: string,
  from: string | undefined,
  width: number,
  opens: readonly AuthorshipOpen[],
  asked: string,
): Effect.Effect<PathAuthorship, ReadingFailure | GateRefusal<AuthorshipReadRefusal>> => {
  const git = actingGit(acting, 'thread-files-commit');
  const resolved = (revision: string) =>
    Effect.flatMap(Effect.catchTag(commitOf(git, dir, revision, { capture: COMMIT_RECORD }), 'GitRefused', refusedByGit), (sha) =>
      sha !== null
        ? Effect.succeed(sha)
        : Effect.fail(
            new GateRefusal('not-found', `${revision} names no commit in this checkout`, [
              'name a commit this checkout holds, as its history spells it',
            ]),
          ),
    );
  return Effect.gen(function* () {
    const sha = yield* resolved(commit);
    const since = from === undefined ? null : yield* resolved(from);
    const at = `commit${NUL}${rootId}${NUL}${since ?? ''}${NUL}${sha}${NUL}${named}${opens.length === 0 ? '' : `${NUL}${asked}`}`;
    const key = `commit${NUL}${since ?? ''}${NUL}${sha}`;
    const kept = cache.keptAt(at, key, width, opens);
    if (kept !== null) return kept;
    const parent = since ?? (yield* Effect.catchTag(commitOf(git, dir, `${sha}^`, { capture: COMMIT_RECORD }), 'GitRefused', refusedByGit));
    const before = yield* entryAt(git, dir, parent, named);
    const after = yield* entryAt(git, dir, sha, named);
    const submodule = pastSubmodule(before, after);
    if (submodule !== null) {
      const source =
        before !== null || after === null || parent === null
          ? null
          : yield* Effect.catchTag(renamedFromAt(git, dir, parent, sha, named, { capture: READING_CAPTURE }), 'GitRefused', refusedByGit);
      const change = source === null ? submodule : pastSubmodule(yield* entryAt(git, dir, parent, source), after);
      const reading = submoduleAnswer(rootId, named, change ?? submodule);
      const answer = source === null ? reading : { ...reading, sides: { ...reading.sides, before: source } };
      cache.keep(at, { key, context: width, answer });
      return answer;
    }
    const side = (revision: string | null, at: string): Effect.Effect<End, GitUnreadable | GitAnswerInvalid> =>
      revision === null || at === ''
        ? Effect.succeed(null)
        : blobEnd(acting, fileAt(git, dir, revision, at, { capture: READING_CAPTURE }), dir, revision, at);
    const bytes = yield* side(sha, named);
    const standing = yield* side(parent, named);
    const source =
      standing !== null || bytes === null || parent === null
        ? null
        : yield* Effect.catchTag(renamedFromAt(git, dir, parent, sha, named, { capture: READING_CAPTURE }), 'GitRefused', refusedByGit);
    const base = source === null ? standing : yield* side(parent, source);
    if (base === null && bytes === null) {
      return yield* new GateRefusal(
        'not-found',
        `${named === '' ? 'the checkout root' : named} is a file in neither ${sha.slice(0, 7)} nor ${since === null ? 'its first parent' : since.slice(0, 7)}`,
        [since === null ? 'name a file that commit or its parent holds' : 'name a file one end of the range holds'],
      );
    }
    const answer = yield* placedOf(
      named,
      yield* authorshipOf(walks, rootId, named, base, bytes, [], width, opens, AUTHORSHIP_ANSWER_LINES, false, source ?? named),
    );
    cache.keep(at, { key, context: width, answer });
    return answer;
  });
};

export const authorshipAt = (
  readers: AuthorshipReaders,
  cache: AuthorshipCache,
  rootId: RootId,
  path: string,
  context?: number,
  open?: readonly AuthorshipOpen[],
  commit?: string,
  since?: string,
  side?: AuthorshipSide,
): Effect.Effect<PathAuthorship, ReadingFailure | GateRefusal<AuthorshipReadRefusal>> => {
  const width = context ?? PATCH_CONTEXT_LINES;
  const opens = [...(open ?? [])].sort((one, two) => one.at - two.at || one.lines - two.lines);
  const asked = `${width}${NUL}${opens.map((one) => `${one.at}:${one.lines}`).join(',')}`;
  return Effect.gen(function* () {
    const root = yield* readers.roots.read(rootId);
    const inside = confineToTree(root.path, path);
    if (inside === null) {
      return yield* new GateRefusal('path-outside-tree', `path escapes the checkout it was asked in: ${path}`, [
        'name a path inside the checkout, relative to its root',
      ]);
    }
    const named = relative(root.path, inside);
    if (named === readers.graphDirectory || named.startsWith(`${readers.graphDirectory}/`)) {
      return yield* new GateRefusal(
        'graph-path',
        `${named} is the graph's own tree, which this server writes as its own stream and no session authors`,
        ['read a path of your own work instead', 'the block tree is read through the graph, never as files'],
      );
    }
    if (side !== undefined && (commit !== undefined || since !== undefined)) {
      return yield* new GateRefusal('side-with-commit', `${side} is a half of the working change, and ${commit ?? since} names history`, [
        'drop side to read a commit or a range',
        'drop commit and base to read one half of the working change',
      ]);
    }
    if (commit !== undefined || since !== undefined) {
      return yield* committedAuthorship(
        readers.git,
        readers.walks,
        cache,
        rootId,
        root.path,
        named,
        commit ?? 'HEAD',
        since,
        width,
        opens,
        asked,
      );
    }
    const head = yield* entryAt(actingGit(readers.git, 'thread-files-object'), root.path, 'HEAD', named);
    const submodule = yield* workingSubmodule(readers.git, readers.files, root.path, named, head, side);
    if (submodule !== null) return submoduleAnswer(rootId, named, submodule);
    const bytes = yield* workingEnd(readers.files, root.path, named);
    let headRead: { readonly text: End } | null = null;
    if (side !== undefined) {
      const half = yield* halfOf(readers.git, readers.walks, cache, rootId, root.path, named, side, bytes, width, opens, asked);
      if ('answer' in half) return half.answer;
      headRead = half.head;
    }
    yield* readers.commands.settled({ checkout: rootId, paths: [named] });
    const judged = (yield* readers.holdings.judged(rootId, [named])).get(named);
    const object = head?.object ?? null;
    if (object === null && bytes === null) {
      return yield* new GateRefusal('not-found', `${named} stands in neither HEAD nor the working tree of this checkout`, [
        'name a path the branch carries, or one a session has written',
      ]);
    }
    const at = opens.length === 0 ? `${rootId}${NUL}${named}` : `${rootId}${NUL}${named}${NUL}${asked}`;
    const key = `${digestOf(bytes)}${NUL}${object ?? ''}${NUL}${judged?.print ?? ''}`;
    const kept = cache.keptAt(at, key, width, opens);
    if (kept !== null) return kept;
    const base = headRead !== null ? headRead.text : yield* headEnd(readers.git, root.path, named);
    const writers = judged?.verdict.verdict === 'proven' ? judged.verdict.hands.map((hand) => hand.holder) : [];
    const carries = carriesOf(judged?.verdict, yield* readers.names(writers));
    const answer = yield* placedOf(
      named,
      yield* authorshipOf(
        readers.walks,
        rootId,
        named,
        base,
        bytes,
        carries,
        width,
        opens,
        AUTHORSHIP_ANSWER_LINES,
        yield* endsOf(readers.git, root.path, named, base, bytes),
      ),
    );
    cache.keep(at, { key, context: width, answer });
    return answer;
  });
};

export const authorshipOver = (
  readers: AuthorshipReaders,
  checkouts: CheckoutRows['Service'],
): { readonly service: Authorship['Service']; readonly stop: () => void } => {
  const cache = new AuthorshipCache();
  const stopMarks = checkouts.onMark((rootId) => Effect.sync(() => cache.dropRoot(rootId)));
  const stopChanges = readers.holdings.changed((change) => Effect.sync(() => cache.dropRoot(change.checkout)));
  return {
    service: {
      read: (rootId, path, context, open, commit, since, side) =>
        authorshipAt(readers, cache, rootId, path, context, open, commit, since, side),
    },
    stop: () => {
      stopMarks();
      stopChanges();
    },
  };
};
