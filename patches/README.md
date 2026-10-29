# Dependency patches

Wired through `patchedDependencies` in the root `package.json`, applied by `bun install`. A patch is
pinned to an exact version: a version bump detaches it, and what it fixed comes back without a word.
Read the section for a package before changing its version.

## A hunk lands only with a test that is red without it

Beside each patch stands `<pkg>@<version>.hunks.json`: per hunk its markers (substrings of its added
lines) and its tests. `bun run patches:prove` cuts the patch by hunk, builds the dependency without
each one in a copy of its own, runs that hunk's tests against the copy and demands red, then runs
everything against a copy with the whole patch and demands green. The shared install is never written:
bun test loads the copy through a preload, vitest through a config that inlines the package and serves
its files from the copy. Only the trap's own runner runs — never the package's whole `test` script — so
a red names the failing tests, or says the runner failed before any test did. Whatever a trap needs
built beforehand is the caller's to build. A diff block with no owner or two owners, a hunk without
tests, a green without the hunk — each refuses. `bun run patches:prove <hunk>` proves one hunk inside the thirty-second gate; a hunk whose only
proof is an e2e elsewhere is printed, not run.

A hunk switched off without being lost carries `off` in the manifest — the reason, in one line — and its
blocks stand in `<pkg>@<version>.off.patch`, a diff on top of the applied patch, which bun never reads.
`patches:prove` names an off hunk and proves nothing for it; an off hunk still in the applied patch, or
an off patch missing or holding a block no off hunk owns, refuses.

Regenerating a patch: the pristine package from bun's cache (`$(bun pm cache)/<pkg>@<version>@@@1`), a
git repository outside the checkout, `git apply` of the previous patch, and `git diff` is the new one;
`bun install` then re-links the patched copy. bun applies a patch by line, so a hunk header cut for
another version lands the hunk one line off.

---

## `effect@4.0.1.patch`

`Statement.withConnectionSpan` provides `sql.execute` as the parent of connection acquisition and execution only while the fiber reference `Statement.SpanPropagationEnabled` is true, and its default is false. Statements run in whatever fiber calls them — HTTP and socket doors, background fibers, fibers started with `Effect.runFork` from callbacks — so no single provider reaches them all, and with the default the SQLite connection annotates the caller instead of the SQL span. The patch flips the reference's default to true in both the shipped source and runtime.

The `sql-parent-span` hunk is generated from Bun's pristine 4.0.1 package. Its trap is `packages/sqlite-process/src/telemetry.itest.ts`: successful and failed SQL statements must carry their own normalized identity and queue/engine timing. Run `bun run patches:prove sql-parent-span`.

### When upgrading effect

Read `Statement.SpanPropagationEnabled` and `Statement.withConnectionSpan` in the candidate release and run the trap without this hunk. Remove the patch and its manifest when upstream parents execution on the SQL span by default and the trap passes; otherwise regenerate against the new pristine package.

---

## `@effect%2Fplatform-node-shared@4.0.1.patch`

`File.write` and `File.writeAll` pass undefined offset and length to `fs.write`. Bun 1.4.2 ignores the explicit file position in that call: writing `XY` at byte 8 of `abcdefgh` overwrites the first two bytes. The patch supplies offset 0 and the buffer's byte length in both calls, so seek governs writes as well as reads. `BunFileSystem.layer` uses this same implementation.

Regenerate with `bun patches/platform-positional-write.mjs <pristine-package> patches/@effect%2Fplatform-node-shared@4.0.1.patch`, then `bun install`. The `file-positional-write` hunk's trap is `packages/files/src/position.itest.ts`, proving both public write operations through `BunFileSystem.layer` on a real r+ file. Run `bun run patches:prove file-positional-write`.

When upgrading the platform package or Bun, run the trap without the hunk; remove it only when both sought writes land at the declared byte offset.

---

## `@effect%2Fplatform-bun@4.0.1.patch`

`BunWorker.layerPlatform` closes a worker by posting the close message and waiting up to five seconds for its `close` event; finalizers run uninterruptibly, so nothing cuts that wait short. Bun drops a message a worker receives before it attaches a listener, and `BunWorkerRunner` attaches its listener only when the worker's runner starts, so a scope that closes while the worker is still booting loses the close message and holds the parent for the whole five seconds. The patch terminates a worker that has not yet said anything — its first message is the runner's readiness signal — and asks only a listening worker to close.

The `worker-close-before-ready` hunk is generated from Bun's pristine 4.0.1 package. Its trap is `packages/execution-host/src/workerLifecycle.itest.ts`: closing a real worker before readiness must release its runner without advancing the shutdown grace period on `TestClock`. Run `bun run patches:prove worker-close-before-ready`.

### When upgrading @effect/platform-bun

Read `BunWorker.layerPlatform` and `BunWorkerRunner` in the candidate release and run the trap without this hunk. Remove the patch and its manifest when a worker closed before readiness no longer holds the parent, and the trap passes.

---

## `@xterm%2Fheadless@6.1.0-beta.302.patch`

One hunk, and the package ships a minified bundle: the diff is one enormous line, so the readable
source of this patch is the two scripts beside it — `xterm-dynamic-storage.mjs` (the bounded stores,
the trim door and the write buffer, every replacement with its anchor and the reason for it) and
`xterm-parse-state.mjs` (the parse-state door). Regenerate deterministically, with no commit anywhere:

```sh
P=$(ls -d "$(bun pm cache)"/@xterm/headless@6.1.0-*@@@1 | grep -v patch_hash)
mkdir -p work/old && cp -R "$P/." work/old/
bun patches/xterm-dynamic-storage.mjs "$P" work/new && bun patches/xterm-parse-state.mjs work/new
(cd work && git diff --no-index old new | sed -e 's#a/old/#a/#g' -e 's#b/new/#b/#g') > patches/@xterm%2Fheadless@6.1.0-beta.302.patch
```

A reviewer reproduces the patch rather than reading it.

The engine retains three stores that grow with what the child writes and that no published option
bounds: the combined-character string a cell holds when a grapheme cluster lands on it, the
extended-attribute entry a cell holds for an underline style, colour or link, and the OSC 8 link data
the terminal keeps while a line still carries it. `BufferLine.addCodepointToCell` appends to a cell's
cluster with no end, and `OscLinkService.registerLink` retains a URI per entry with no end — a child
that writes them writes into the host's memory, which is the defect this patch closes.

The patch gives the terminal one accountant: `new Terminal({ dynamicStorage: { lineBytes, linkBytes }})`
declares what one buffer line and the whole terminal's links may hold, and the optional
`terminal.dynamicStorage` answers `{ lineBytes, linkBytes, refusal }` — optional because it is a
capability of THIS build, which is also what keeps the headless Terminal structurally compatible with
addons typed against `@xterm/xterm`: an addon declares `activate(terminal: Terminal)` of ITS Terminal,
and a required member here would make this build's Terminal unassignable to that one. A line carries
its own account and charges what it HOLDS: a cell written over another drops the entry it replaces, so
erasing, scrolling, inserting, deleting and recycling all release through the same code that drops the
entries. Link data is charged per entry and per line marker and released when the marker's line leaves
the buffer. A REP demanding more than one parse may allocate is refused instead of sizing a
multi-hundred-megabyte array. Past a declared limit the store refuses, the refusal is final, and no
later chunk is interpreted; the remainder of the chunk the refusal fell inside still runs through the
parser, into a screen the consumer has already declared gone. Zero or an omitted limit is the stock
unbounded behaviour.

The answered `lineBytes` is a RUNNING total — the sum over every line both buffers hold — so a host
reads what one terminal retains after every chunk instead of walking a scrollback. Two owners move it,
and between them they cover every road a line has: the LINE as its own entries are put and dropped, and
the RING (`CircularList`) as a line enters or leaves a slot. The ring is where the second half has to
be — a line leaves a buffer when a scroll region shifts one line over another, when a splice deletes
one, when a reflow rearranges the layout or the ring is re-sized, and the engine tells nobody. A line
built before it enters a buffer is charged when the ring takes it, not when it is built, which is what
a blank line born with an extended attribute on every cell needs.

`terminal.trimHistory(rows)` drops that many of the OLDEST rows of the normal buffer's history and
answers how many went. The published road cannot be this door: lowering `options.scrollback` runs
`Buffer.resize`, which resets `scrollTop` to 0 — an application holding a scroll region is corrupted,
with no resize for it to redraw on — and `CircularList.trimStart` moves its start index while the
trimmed line objects stay referenced by the ring until it wraps. This patch repairs the second in the
ring itself: every slot the ring lets go is nulled, so what leaves a buffer leaves memory. `trimHistory`
moves `ybase`, `ydisp` and `savedY` exactly as `resize` moves them when the scrollback shrinks, and
touches nothing else; the markers on the trimmed rows are disposed by the ring's own `onTrim`, so the
OSC 8 entries holding them release with their lines.

The same block repairs the write buffer, because bounding the stores is worth nothing if the consumer
cannot act on the parse it just awaited. Stock `_innerWrite` calls a chunk's callback while that entry
is still queued and `_bufferOffset` has not advanced, and stock `flushSync` — which every `resize` runs
— shifts from the FRONT ignoring that offset and leaves it at 2147483647. So a callback that resizes
gets its own chunk parsed and acknowledged twice, and the chunk it queues next is discarded unanswered:
the caller waits forever. The patch retires the callback and advances the offset before invoking it, and
flushes from the offset the loop stands at, leaving it at zero. A consumer that does not re-enter sees
the same callbacks in the same order.

`packages/execution-host` is the only consumer: `Interpretation` derives both limits from the
execution's `parser.cellBytes`, which it spends as fixed cell arrays plus dynamic storage, and turns a
refusal into `InterpretationUnavailable{reason:'budget'}` at the frontier the parser had reached
before the refused chunk. `Interpretation.retained()` spends the same account outward — the fixed cell
arrays of every line both buffers keep plus `lineBytes` and `linkBytes` — and `Interpretation.trim(n)`
is the door onto `trimHistory`. It carries no scheduler of its own around any of this.

`terminal.parseState` answers `{ rest, printed }`. `rest` is the parser in its ground state with no
partial UTF-8 sequence, no open OSC, DCS, APC, PM or SOS string and no paused handler stack: the next
byte is read the way a fresh parser reads it. `printed` is the parser's `precedingJoinState` standing,
which every control, escape and string sequence clears: the width of a following joining character and
a following REP read the character the last print left behind. Both live in private parser and decoder
fields a minified bundle renames without notice, which is why they are a door of this build rather than
reads of internals. `Interpretation` takes a screen checkpoint only at `rest`, and a checkpoint that
ends right after a print re-prints that cell last, so `printed` survives the restore.

Trap: `packages/execution-host/src/Interpretation.test.ts -t storage`. Without the hunk the engine
ignores the declared limits, so the cluster, the link budget and the reclaim cases assert a named
refusal a stock engine never produces; and `storage: reflows into a narrower screen inside the budget
that reserved both layouts` hangs on the write-buffer defect, which is what makes the second half of the
block red on its own. The account and the trim door ride the same trap: a stock engine answers no
`dynamicStorage` at all, so the interpreter refuses to open over it and every case in the block fails.
`storage: the running line total equals a walk of both buffers through every road a line leaves by` is
the one that would go red on a NEW road — a future engine dropping lines somewhere this patch does not
charge — rather than on the hunk's absence.

The parse-state door rides the same hunk with its own trap, `packages/execution-host/src/ScreenCheckpoint.test.ts`:
over an engine patched by `xterm-dynamic-storage.mjs` alone every case fails on `the parser was not at
rest`, because no checkpoint is ever taken without the door.

### When upgrading `@xterm/headless`

1. Re-run both scripts against the new pristine package: every anchor is asserted, so a moved fragment
   refuses instead of landing silently.
2. If the engine publishes its own bound over these stores, the patch goes and `Interpretation` binds
   the published option instead.

---

## The browser xterm set: `@xterm%2Fxterm`, `@xterm%2Faddon-webgl`, `@xterm%2Faddon-serialize`, `@xterm%2Faddon-ligatures`

Four source changes the terminal needs and upstream has not taken. All four packages are published
from one upstream commit — `d3e32b344dfe7dd6015cff6a9aeaaeaeccdc2789`, which each tarball names in
`package.json.commit` — so the version strings differ while the tree behind them is one.

`@xterm/xterm` carries the IME transaction and a `SortedList` fix. `CompositionHelper` becomes
transactional: a composition raises `xterm-composition-session-start`, `-session-end` and
`-transaction-accepted` on the helper textarea with a transaction id, so a page can follow a CJK
composition with its candidate window and hold a chord until the commit instead of guessing from
`onData`. `SortedList.delete` flushes its deferred deletions and retries when the binary search
misses, because disposing a marker resets `line` — the sort key — and a decoration whose removal is
missed paints forever; a cleared search is where that shows.

`@xterm/addon-webgl` writes transparent for a `v_texpage` beyond the sampler budget rather than
leaving `outColor` unwritten, which is undefined behaviour in GLSL ES; evicts every atlas page on
`clearTexture`, so a merged page 0 cannot make later clears no-ops; probes the rasterization font
weight, because Canvas silently keeps its previous font when an assignment fails to parse; and tests
the merge-retry budget before `beginFrame`, which latches the page layout version it observed.

`@xterm/addon-serialize` carries the OSC 8 pen through a round trip and diffs bold and dim as one
intensity group, because they share the single reset 22.

`@xterm/addon-ligatures` is a fifteen-line `package.json` edit: `module` and a new `exports` map both
point at the CJS `lib/addon-ligatures.js`. The published ESM half calls `require("fs")`, so a bundler
resolving `module` or `import` reaches a browser-unusable bundle.

### Regenerating

The source of truth is Orca's `config/patches/xterm-src/*.src.patch` and its
`config/scripts/regenerate-xterm-patches.mjs`, documented in
`docs/reference/xterm-patch-regeneration.md` of that checkout: it clones the pinned commit, installs
upstream's pinned toolchain, asserts an unmodified build reproduces the published `lib/` byte for
byte, then emits the source and bundle hunks together. Source maps are included, and are never
dropped on their own: the patch moves code, so a map left behind points at the wrong lines.

Never edit one of these `.patch` files by hand. Regenerate, then confirm the result applies to the
pristine tarball from bun's cache with no fuzz and no offset before `bun install` takes it.

### What the manifests prove, and what they do not

Each of these patches carries every change in one minified bundle line, so a diff block cannot be
attributed to one change of several: the manifest names ONE hunk per package, and its markers cover
every block. Taking that hunk out therefore leaves the pristine package, which is what the runner
installs for the trial.

`@xterm/xterm` and `@xterm/addon-serialize` have manifests, and their traps are red without them:
`apps/tagma/app/src/lib/features/terminals/xtermPatch.test.ts` observes the composition transaction
events, and `serializePatch.test.ts` the OSC 8 round trip and the intensity group. The `SortedList`
half rides in the same inseparable hunk and has no trap of its own; one would have to make the list
miss — delete one decoration to queue a deferred deletion, then dispose the marker under another —
through xterm's public decoration surface.

`@xterm/addon-webgl` and `@xterm/addon-ligatures` carry no manifest, and `patches:prove` therefore
says nothing about them. The WebGL hunks need a real GL context: the shader fallback, the atlas
eviction and the merge-retry budget are all observed on a GPU, which no test here has. The ligatures
hunk is about how a BUNDLER resolves the package, so a unit test passes with or without it — the
build is what would fail. Both are named here rather than given a trap that cannot fail.

---

## `svelte@5.57.0.patch`

Nine hunks: 1, 2, 7, 10 and 11 stand in the applied patch; 5, 6, 8 and 9 are off while Tagma compiles
without `experimental.async` (below), kept in `svelte@5.57.0.off.patch`. 1, 2, 5 and 6 are carried from shop `core-refactor` at `8c71394ba0`, 7 and 8 from shop
`release` at `9de9eb1deb`, 9, 10 and 11 are runlith's own. Three of the first four are about one thing: the
graph's services live in detached roots (`detachedRoot` in `packages/layer/src/svelte/App.svelte.ts`),
their effects stand outside the component tree, and Svelte's batch scheduler in async mode does not
count them as its own at time travel and at commit. On 5.57.0 `batch.js` is byte-identical to 5.56.10;
`runtime.js` differs (`update_reaction` split into `update_dependencies`), so hunk 6's `get()` piece is
cut against 5.57.0's context.

### How a batch lives with `await`

A batch holding an `await` stays in the list of live batches until the wait ends. The other batches of
that window time-travel around it: `apply()` hands them its `previous` values instead. Three states:

| state | when | what the others see |
| --- | --- | --- |
| C · no await | an ordinary write | everything |
| A · blocking | an `await` under an already rendered boundary | the world without this batch: its effects are deferred, nothing of it is on screen |
| B · pending | an `await` under a boundary with `pending` | before hunk 5 — the same revert, although the DOM already shows the batch |

At commit Svelte reruns only the async and block effects that depend on both worlds, and the effects
created inside the batch itself. An ordinary `$effect` that ran in a foreign batch over a reverted value
stays CLEAN.

### 1 · `index.js`: export `without_reactive_context`

A service root is created outside a foreign effect, otherwise it becomes a child of the branch that a
session change tears down with it. The import lives in `packages/layer/src/svelte/detach.ts`, because
the compiler refuses `svelte/internal/*` inside a runes file.

Trap: `packages/layer/src/svelte/detached-root.svelte.test.ts`.

### 2 · `batch.js`, `Batch.schedule`: no early exit on a cleared `CLEAN`

Scheduling an effect, `schedule` walks up to the topmost ancestor, clearing the `CLEAN` bit off every
ROOT/BRANCH on the way. A branch already cleared the original takes as queued by somebody and bails. A
branch a batch marked and never reached is flushed by nobody: the bit stays cleared, and every later
`schedule` under it returns early. The patch always walks to the top and deduplicates the root queue —
exactly what the bail was buying.

Symptom in shop: a guest on a game page signs up, the screen stays on "Loading…" forever, the launch
request never leaves. Here the equivalent is a branch switch on a busy graph.

Where the cleared bit comes from, by the scheduler log of that spec without the hunk: `#process` moves
the roots scheduled during its traversal into the next batch without clearing its own `#roots`; the
session-swap batch, already unlinked, is processed once more with the same root, and `#traverse` does
`root.f ^= CLEAN` on a clean root — bit cleared. A unit trap needs that second entry into a committed
batch; who makes it is not found yet, so the hunk is proven by e2e alone.

Trap: shop `apps/acme/e2e/domains/game-page/game-page.mock.spec.ts › switches to real mode via signup`
(4 of 4 red without the hunk). No unit here distinguishes it.

### 5 · `batch.js`, `Batch.apply`: a flushed batch counts as applied

A batch whose effects already ran (`#flushed` after `flush_queued_effects`) is skipped in `apply()`:
its values sit in `source.v` and in the DOM, and reverting them for a neighbour shows it a world the
screen has left. Svelte already treats intersecting batches this way. Writes made in a continuation
after an `await` are not reverted either: no macrotask separates them from the flush.

Symptom, measured in shop with the search box temporarily under a boundary with `pending`: on the game
route the Rewards presenter sees the results with the profile `undefined` and never runs again.

Trap: `time-travel.svelte.test.ts -t pending`.

### 6 · `batch.js` + `runtime.js`: stale readers rerun at commit

`apply()` keeps `reverted_by` beside `batch_values`: which batch reverted this value. `get()` through a
revert notes the active reaction and the active effect into the owner's `#stale`; a derived computed
over a revert enters `reverted_by` itself, so its readers go stale too. When the owner is processed,
stale effects go to `#dirty_effects`, stale deriveds take DIRTY and a fresh `wv`. `#merge` carries the
set, `discard` clears it: the world without the discarded batch is the outcome. A read under `untrack`
is not noted.

Exactly what read the revert reruns. An effect whose dependencies did not change does not run: in shop's
cbc a `GameScreen` teardown cancels the game launch, and both wider forms of the earlier hunk (DIRTY on
every deferred effect; `wv` over the whole of `current`) dropped it. The earlier hunks 3 (a write during
a deferred batch's traversal stays in it) and 4 (`wv` over every `previous`) were special cases of this.

Traps: `time-travel.svelte.test.ts -t blocking`; in shop, cbc `game-session.mock.spec.ts › opens a game
from a catalog card` and `after-deposit-prompt.mock.spec.ts › waits out a running game session`.

### 7 · `batch.js`, `schedule_effect`: no current batch — a new one is made

Upstream [sveltejs/svelte#18850](https://github.com/sveltejs/svelte/issues/18850), a regression since
5.54.0; the fix is [PR #18863](https://github.com/sveltejs/svelte/pull/18863), the same
`Batch.ensure().schedule(effect)`. `#process` clears `current_batch` before flushing effects; an effect
that on its first run writes what it just read and flushes in the same run reaches its self-invalidation
with no batch and throws `Cannot read properties of null (reading 'schedule')`.

Symptom in shop: acme prod on 5.57.0, the route's error boundary replaced `/balance-multiplication`.

Trap: `packages/layer/src/svelte/effect-self-invalidation.svelte.test.ts`.

### 8 · `batch.js`, `Batch.#commit`: a rebase defers what it reaches

Upstream [sveltejs/svelte#18895](https://github.com/sveltejs/svelte/issues/18895), in 5.57.1 and in
`main`; the fix is the open [PR #18896](https://github.com/sveltejs/svelte/pull/18896). A batch held by
an `await` is rebased each time another batch commits, and the rebase traverses with
`#traverse(root, [], [])`: what it collects is thrown away and stays DIRTY, and no later write schedules
it again. The hunk keeps `#scheduled` — the effects scheduled onto a batch since its last `#process` —
and after the traversal defers into the rebased batch only those, as PR #18896 does; the DEV invariant
"Batch has scheduled roots" goes, since that state is legal. Deferring everything the traversal reached
is wrong: a shared root's traversal also collects other batches' effects, which then turn CLEAN and wait
for the held batch.

Symptom in shop: mobile game search after a reload stays empty for good.

Trap: `packages/layer/src/svelte/rebase.svelte.test.ts`, the reproduction of #18895. shop's own trap
(`time-travel.svelte.test.ts -t "woken by a write after the await"`) is green here without the hunk.

### 9 · `batch.js`, `#traverse`: a later batch skips the branches a batch it carries removes

When an `{#if}`, `{#each}` or `{#key}` changes inside a batch held by an `await`, the branch it leaves
stays on screen until that batch commits; the batch puts it in its `#skipped_branches`, and its own
traversal never enters it. A later batch that writes a value the held one also wrote intersects it:
`apply()` does not revert the held batch's values for it, so the later batch sees the condition that
already broke — but it skips only its own `#skipped_branches`. Its traversal enters the doomed branch and
runs the block effects there at once, against values the branch was guarded from: a child reading
`host.activeId` through a prop getter after `{#if host !== null}` became false throws. Render and managed
effects in that branch are collected and deferred with the merge, so only block effects (`{#if}`,
`{#each}`, `{#key}`, `{#await}`, `{@render}`, a dynamic component) throw. The hunk computes in `#traverse` the earlier batches that still
have branch changes to commit and whose values this batch sees, and skips a branch when the nearest batch
that decided it — this one, then those from the nearest — removes it: a nearer batch that brought the
branch back (`#unskipped_branches`) outweighs an older removal. Pristine 5.57.0 and 5.57.2 throw the same;
no upstream issue reports it.

Symptom: the agents column of the Tagma window fell into its error boundary with
`Cannot read properties of null (reading 'activeId')` when the thread page gave up the main seat while
another write of the same navigation was in flight.

Trap: `packages/layer/src/svelte/branch-removal.svelte.test.ts`, the column's shape:
`{#if}{#key}` over a child that passes a field of the guarded value to a row reading it in a block. The
nearest-decision rule has no trap: a third batch intersecting a removal and a nearer return merges into
the return once its own `await` ends, so a wrong skip only delays it; a scheduler trace shows the skip.

### 10 · `batch.js`, `#process`: a teardown while a batch processes updates the blocks it marks first

In async mode a branch an `{#if}`, `{#each}` or `{#key}` leaves is destroyed by the batch's commit
callbacks, after `current_batch` was cleared and before the render and user effects the traversal
collected run. A teardown there — `onDestroy`, an effect cleanup, an attachment's — that writes state
opens the next batch, which marks the block guarding on that value but runs only after this one. The
committing batch's own queue then runs its collected effects that the write dirtied, inside a branch
the next batch is about to remove: a child reading `host.activeId` through a prop after
`{#if host !== null}` became false throws. `flush_queued_effects` already answers the same write made
by a queued effect: `eager_block_effects` collects the marked blocks and runs them, ancestors first,
before the next effect. The hunk opens that collection for the commit callbacks as well and runs it at
the start of the queue flush; the loop moved into `flush_eager_block_effects`, shared by both. A
`flushSync` inside such a teardown or inside an eager update processes another batch with its own
collection: `#process` restores the collector it replaced once it ends, and the flush walks the set it
started with, so the nested flush neither drops the outer collection nor clears it under the walk. Pristine 5.57.0
and upstream `main` run the commit callbacks the same way; no upstream issue reports it.

Without async mode the same write happens earlier: a branch the traversal leaves is destroyed inside
`#traverse`, and its teardown's write goes through `legacy_updates` into the next batch. A block earlier
in the tree, which the traversal has already passed, is marked there; this batch then runs the effects
it collected under that block before the next batch updates it. So in sync mode the collection opens
before the traversal. In async mode it still opens only at the commit callbacks: `should_defer_append`
answers false while a collector stands, and a collector open during the traversal would stop every
branch switch from waiting for the commit. The flush skips a collected block that is no longer dirty,
since a block later in the tree is updated by the traversal itself after the write marked it, and it
takes each block out of the set as it reaches it: a block whose teardown clears a guard the walk has
already updated marks that guard again, and the walk reaches it once more instead of leaving it marked
under the batch's effects. When the cleared guard stands above the removed branch, the traversal is
still inside it: from there on it runs no render, block or pre effect under a collected block that is
still marked, and queues it with the render effects instead, which the sync traversal otherwise leaves
empty. The queue flush updates the blocks first and then runs what still stands; the effect is not
asked whether it is dirty before that, since asking recomputes the deriveds it reads.

Symptom: the agents column of the Tagma window fell into its error boundary with
`Cannot read properties of null (reading 'activeId')` when a project the window stood on was renamed:
the stack ends in a row's template effect run by `flush`; the batch that removed the thread page had
reached the column's rows, and the page's teardown released the main seat (`ThreadSeats.page`) the
column is guarded on. In sync mode the whole window fell into its `window` boundary with
`Cannot read properties of null (reading 'measure')`: the top row's seam handles stand under
`{#if columnSeam !== null}` and `{#if areaSeam !== null}` in `TopBar`, earlier in the tree than the
section column and the right area, whose teardowns clear those seams in `AreaFrame`.

Traps: `packages/layer/src/svelte/nested-eager-flush.svelte.test.ts`, the nested flush in sync mode;
`packages/layer/src/svelte/passed-guard.svelte.test.ts`, a guard the sync traversal passed, cleared by
the teardown of a later branch, cleared once more by a block the walk runs after it, and cleared by a
teardown inside the guarded branch;
`packages/layer/src/svelte/seat-release.svelte.test.ts`, the shape alone and with a `flushSync` in the
guarded branch's teardown; the column itself in
`apps/tagma/app/src/lib/features/threads/Column.svelte.test.ts -t "leaves when the page"`. The last two
are async-mode traps and stay green without the hunk in sync mode.

### Async mode is off

The app and every package config compile with `experimental: { async: false }`. Hunks 5, 6, 8 and 9
fix batches held by an `await`, which exist only in async mode; their traps use `await` in markup and
do not compile without it. Hunk 10 stays: its commit-callback case is async-only — without the flag a
branch switch commits at once (`should_defer_append` answers false) — but in sync mode the same teardown
runs during the traversal, which the hunk collects from (`passed-guard.svelte.test.ts`), and its
nested-flush half holds as well. A queued effect that closes a branch puts the block in the eager set, the
branch's teardown flushes, the nested flush ends by clearing the shared collector, and the outer flush
then reads `null`; `nested-eager-flush.svelte.test.ts` is that trap, red without the hunk. Hunks 1 and
7 stay red without themselves in sync mode, and 2 is not tied to the mode.

Tests that need async mode are parked, not deleted, in `svelte@5.57.0.off/` at their repository paths:
neither Vitest nor svelte-check reads that directory, and svelte-check compiles every `.svelte` file of
a package whatever its tsconfig excludes, so a fixture with `await` cannot stay in place. Parked:

- `packages/layer`: the traps of 8 and 9 (`rebase`, `branch-removal`) with their fixtures; the
  originals of `time-travel.svelte.test.ts` and its `Host.svelte` with `Page.svelte` — the traps of 5
  and 6 are its `pending` and `blocking` doors, and the copies in place keep the `handle` door, which
  reads a deferred key's `.current` in any mode; `deferred-tree.svelte.test.ts` with `DeferredApp` and
  `DeferredConsumer`, a deferred key awaited in a component under a `pending` boundary; and the
  originals of `session-handoff.svelte.test.ts`, `HandoffFrame.svelte` and `HandoffProbe.svelte`, whose
  second case lets the incoming frame await its chunk — the copies in place keep the first case alone;
- `packages/query`: `single.fork.test.ts` with `ForkRouteProbe`, since `fork` throws without the flag;
- `apps/tagma/app`: `RenderingPorts.svelte.test.ts` with `RewindClaim.fixture.svelte`, a rewind claim
  taken while its release's batch awaits.

Turning async mode back on: `async: true` in `apps/tagma/app/svelte.config.js`, every package Vite
config and `packages/layer/svelte.config.js`; copy `svelte@5.57.0.off/` over the repository root, the
parked originals replacing the reduced time-travel and session-handoff files in place; apply `svelte@5.57.0.off.patch` on top
of the applied patch and `git diff` the result against the pristine package as the new
`svelte@5.57.0.patch`; remove the off patch, the parked directory and the `off` fields; `bun install`;
`bun run patches:prove`.

### 11 · `template.js`, `from_html` and `from_namespace`: templates are cloned into the document

An HTML template's master copy lives in the content of a `<template>` element, which belongs to a separate
inert document. Upstream clones it with `importNode` only in Firefox or when the compiler flags the
template (a custom element, `<video>`), and with `cloneNode` otherwise, so the clone starts in that inert
document, while the anchors and fragments Svelte creates itself (`create_text`, `comment()`) belong to the
page's. Each insertion across the two adopts the moved subtree node by node, and a nested tree is adopted
again at every level whose parent stands in the other document. The hunk clones with `importNode` always,
so a clone belongs to the page from the start and inserting it adopts nothing. In `from_namespace` a
multi-node SVG or MathML master is already a page-document fragment; the hunk changes only the
single-element master, which stays in the template's document. `from_tree` keeps `cloneNode`: its master
copy is built with the page's `createElement`.

Why upstream stops at Firefox: `is_firefox` came with sveltejs/svelte#15272 (February 2025), which moved
Firefox to `importNode` to fix lazy `<img>` attributes (#15141). Chromium and WebKit stayed on `cloneNode`
on one remark in that review: `importNode` is "much slower in Chrome than `cloneNode`", citing Chromium
issue 371247940, which is not publicly readable. That shape — the clone call alone — does measure slower:
3000 clones of a 25-node tree took 7.5 ms with `cloneNode` and 10.6 ms with `importNode` in Chromium 151
(9.9 and 14.6 ms per 1000 at 4× CPU), and 15 and 16 ms in WebKit, about a microsecond per clone. It does not
hold for a mount, where the clone is inserted: with Svelte's nesting — a component's clone placed before a
page-document anchor inside its parent's clone, attributes and a listener set before insertion — 1000 rows
in the chat-ui stand's document took 13.7 ms with `cloneNode` and 11.3 ms with `importNode` in Chromium,
32 and 25 ms in WebKit. Upstream is moving the same way: sveltejs/svelte#18834 (open) shows Chromium
leaking responsive images through this cross-document assembly, and draft #18835 moves every `from_html`
clone to `importNode`, "taking the slight perf hit".

Symptom: in Chromium at 4× CPU throttling, mounting one heavy feed row spent most of its time in the
native `before` of Svelte's `append`. Measured on two stand builds differing only in this call, on an idle
M2 Max: over one recording of the chat-ui stand's scroll controls `before` totalled 63.7 ms with
`cloneNode` and 26.3 ms with `importNode`, against 5.6 and 5.4 ms for the clone calls; opening a thread
took 54.9 and 48.4 ms at the median at 4× (p90 62.1 and 52.3), 11.3 and 10.8 ms at 1× (p90 15.0 and 12.7).
WebKit opened it in 19 and 20 ms (p90 23 and 25), within its one-millisecond timer.

Trap: `packages/layer/src/svelte/template-document.test.ts`. A raw snippet rendered inside a template's
element sees that element's document in `setup`; without the hunk it is the inert one.

### Tried and rejected

| variant | result |
| --- | --- |
| `mark_reactions` does not set `WAS_MARKED` | unnecessary: hunk 2 holds the fix alone |
| `clear_marked(effect.deps)` in `destroy_effect` | 5 of 6 red |
| revert `CLEAN` and `WAS_MARKED` in `Batch.discard()` | 5 of 6 red |
| keep collected effects in the rebase branch of `#commit` | 5 of 6 red |
| `DIRTY` on every deferred effect at commit | cbc: the `GameScreen` teardown cancels the launch |
| `wv` over the whole of `current` at commit | cbc: the same; touches values first computed inside the batch |
| roll svelte back to 5.53.5 | green, but drags vite and vite-plugin-svelte along: the versions do not detach one by one |
| a boundary with `pending` without hunk 5 | shop: the presenter runs over the reverted profile 3 of 3 |

### How to check

```sh
bun run patches:prove
bun run --cwd packages/layer test
bun run --cwd packages/query test
bun run --cwd packages/primitives test
```

### When upgrading svelte

1. `Batch.schedule` no longer exits on "branch is already dirty", or roots survive a discarded batch —
   hunk 2 goes.
2. `without_reactive_context` is exported publicly — hunk 1 goes, and `detach.ts` moves to the public
   import.
3. `apply()` no longer reverts a batch whose effects ran — hunk 5 goes.
4. A reaction that read a reverted value reruns at the owner's commit — hunk 6 goes.
5. PR #18863 landed, or #18850 is closed otherwise — hunk 7 goes, its trap stays.
6. PR #18896 landed, or #18895 is closed otherwise — hunk 8 goes, its trap stays.
7. A batch's traversal no longer enters a branch an intersecting earlier batch removes — hunk 9 goes, its
   trap stays.
8. A write by a teardown at commit, or during a sync-mode traversal, no longer lets the batch run
   effects under a block it marked — hunk 10 goes, its traps stay.
9. `from_html` and `from_namespace` clone templates into the page's document in every browser — hunk 11
   goes, its trap stays.
10. While none of this is done, the patch is regenerated for the new version by the method above,
   `patches:prove` is green whole, and the e2e trap of hunk 2 is green in shop.
