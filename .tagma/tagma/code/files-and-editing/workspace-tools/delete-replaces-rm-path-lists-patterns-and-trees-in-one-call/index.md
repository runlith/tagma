---
id: 01a15eda-f791-7c2a-a727-532dfe9afd88
title: "delete replaces rm: path lists, patterns, and trees in one call with authorship and a precise outcome"
ord: 53
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b1b9862e1b
  - kind: relates
    to: 01a14c22-2161-7a9d-95c9-2ffccdb62398
  - kind: relates
    to: 01a15ec4-b364-7b29-bbdf-7c9be2296e2b
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/agent-tools/src/delete.ts
  - kind: file
    ref: packages/agent-tools/src/namespace.ts
  - kind: file
    ref: packages/agent-tools/src/workspace/runtime.ts
  - kind: file
    ref: packages/agent-tools/src/WorkspaceChanges.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/agent/ToolOutput.ts
  - kind: file
    ref: packages/files/src/replace.ts
---
## Outcome

`delete` replaces the ordinary non-interactive `rm`: one call removes any number of files, expands patterns, removes empty directories or trees, and answers for every deletion actually performed. The agent never routes around the tool through Bash over file counts, tree size, binary contents, symlinks, or out-of-project paths. The place's standing rules and the call mode hold; no new confirmations, agent bans, or prior "deletion permission" appear.

This is a tool change, not a Git command: index, HEAD, and branch do not change. In registered checkouts removed files get an author in the ChangeRecord; outside them the same removal runs with explicitly no line accounting. Directories Git never stores never turn into fictitious file changes.

## What stands now

`packages/agent-tools/src/delete.ts` takes a single `path` and refuses directories and missing files. `changed.ts` ties the file act to `WorkspaceChanges.turn/land`; the lower `packages/files/src/replace.ts` checks the standing version before removal. A text file inside the accounting area keeps its former contents; a large external file is never read whole.

In `workspace/runtime.ts` path-resolution errors collapse to `error.reason._tag`: the original cause can be lost behind the word `Unknown`. The observed macOS refusal never establishes which OS operation failed; that must be diagnosed at the error's producer, not declared a permissions error by guess. The `entryIdentity` walk reads the parent directory on a point call; repeating that walk for every file of a mass deletion is out of the question.
## The call, as rm knows it

One contract: `args: string[]`, optional `workdir: string` and `glob: boolean`. `args` are separate arguments after the `rm` name, not a shell string. `workdir` defaults to the tool's working directory; relative operands resolve from it, absolute paths keep their meaning. `glob` is on by default: the tool itself performs the name expansion that the shell performs before an ordinary `rm`. With `glob: false` every operand is literal, including `*`, `?`, `[`, and `~`.

```json
{"args":["--","obsolete.ts"]}
{"args":["--","one.ts","two.ts","three.ts"]}
{"args":["-rf","--","dist","build","cache"]}
{"args":["-f","--","src/**/*.tmp","logs/*.{log,old}"]}
{"args":["-d","--","empty-directory"]}
{"args":["--","notes [draft].md"],"glob":false}
{"args":["-r","--","Application Support/Old App"],"workdir":"/Users/example/Library"}
```

Spaces and newlines inside one array element are part of the name. JSON quotes bound the argument but never switch glob off; a literal name with metacharacters goes through `glob: false` or metacharacter escaping in glob mode. `--` ends option parsing, not pattern expansion; a name with a leading `-` after it stays an operand. A pattern-expanded result is never re-parsed as an option. Commands, `$()` substitutions, `$VAR` variables, pipes, redirects, and shell word splitting never run; the tool starts neither a shell nor an external `rm`.

Supported: `-r`, `-R`, `--recursive`; `-f`, `--force`; `-d`, `--dir`; `-v`, `--verbose`; short combinations like `-rf` and `-vrf`, plus `--one-file-system`, `--preserve-root`, `--preserve-root=all`, `--no-preserve-root`. Options parse up to `--`, including options between operands. Repeating the same option is harmless; for opposing preserve-roots the last one wins. Without `-r` a directory is never walked; with `-d` only an empty one is removed; `-r` beats `-d`.

`-f` tolerates missing paths, no matches, and an empty operand list. It never hides an OS refusal, an unread tree, a version conflict, a law refusal, or a record error. It is no privilege escalation and no review-mode bypass.

Interactive `-i`, `-I`, `--interactive` never start a dialogue inside the tool: the request gets a concrete `unsupported-option` before the first removal, explaining that confirmations are set by Tagma's mode, not stdin. Unsupported platform `rm` extensions also refuse explicitly before mutation. What is promised is full non-interactive removal — not a shell interpreter, secure erase, trash, or a byte-for-byte clone of every BSD/GNU extension. Base-option behaviour is one across supported OSes.

The current `{path}` entry is replaced, not kept as a second API. The tool's own call sites, declaration, saved definitions for new runs, and examples move together; old conversation records stay readable without re-execution.
## Patterns and target selection

In glob mode `*`, `?`, `[...]` and `[!...]` classes, the recursive `**` segment, `{a,b}` alternates with nesting, and backslash metacharacter escaping apply. `**` spans zero or more directories. Numeric brace ranges and extglob are not declared supported: a recognized unsupported construct is a syntax error before mutation. A leading `~/` expands from the execution host's home; `~user` is never guessed. In patterns the separator is `/` on every OS; Windows paths with backslash separators go literally under `glob: false`, and the path owner also understands ordinary literal Windows paths and UNC.

As with shell glob by default, `*` and `**` never select a hidden segment without an explicitly given leading dot. An explicitly selected directory with `-r` is removed with all its entries, hidden and ignored ones included. `.gitignore`, search ignore files, and dependency exclusion rules never filter removal or glob: otherwise the tool would falsely report a removed tree. A pattern selects files, directories, and links alike, dangling symlinks included. No matches is a separate `no-match` outcome, suppressed only by `-f`; read errors during expansion never count as no matches.

Operands go in request order, each pattern's matches in a stable name order, independent of locale. Before the first removal one target set is formed, shared by preparation, law delivery, review mode, execution, and the report. It holds the place identity and the "operand → found entries" links, not the full contents of every file. A syntax error, an unknown option, or an undeterminable scope refuses before mutation. An unreachable branch of a known tree stays an explicitly unexpanded part of the result; reachable independent targets run.

One entry is never removed more than once: overlapping patterns, a repeated path, and a jointly selected directory with its child merge with the selection's provenance kept. Hard links under different names stay different entries and both are removed when both are selected. No dedup by content inode. Spelling and case-folding are set by the standing path owner and the real FS; no textual lowercasing of all names applies. A large set is never cut by an answer limit, and the agent is never made to continue the removal page by page.

`rm` itself never expands patterns: that is the shell's job. Here expansion is deliberately part of the tool, with a fixed contract independent of user `shopt` and shell aliases. The basis for the base options is [GNU rm](https://www.gnu.org/s/coreutils/manual/html_node/rm-invocation.html); for the shell/rm split and hidden-name rules, [Bash filename expansion](https://www.gnu.org/s/bash/manual/html_node/Filename-Expansion).
## Directories, links, and changes during the call

A recursive walk never follows found symlinks or junction/reparse crossings into someone else's tree. A link, broken ones included, is removed as an entry; its target never changes. An explicitly named parent path may pass through a symlink: its place resolves once and is kept for the act, with no re-routing of an already prepared removal after the link is swapped. A trailing symlink is never dereferenced, even with a trailing separator: the link itself is removed. Sockets, FIFOs, and other removable FS entries are never opened for reading as plain text and never refuse only over their kind.

The walk goes bottom-up. Before removing each file or link the standing version/identity is rechecked through the standing file-act owner; a known foreign replacement is never removed. The set never grows once mutations start: a newly created entry is never picked up by a hidden second recursive pass. A parent is removed only by empty-directory removal; a remaining or new child yields `directory-not-empty`, not cascading removal over the record. No atomic transaction over the tree and no removal of a foreign process's residual race between check and syscall is promised.

`--one-file-system` never descends onto another device relative to each explicitly selected root; a skipped boundary shows in the report. Without that option filesystem boundaries alone never stop the walk. `--preserve-root` keeps the filesystem root by default under recursive removal; `--preserve-root=all` also checks each root operand's device boundary; `--no-preserve-root` changes only that behaviour, not law and not OS authority. Trailing `.` and `..` are handled as invalid rm operands before any normalization that could hide their meaning. There are no extra bans by tree size, foreign holder, or location outside the current project.
## Owners and authorship

`@runlith/agent-tools` owns the rm entry, removal-target expansion, walk order, the single outcome, and the projection into the tool. `delete.ts` keeps one door, not a hundred recursive runs of a point tool. Argument parsing and target selection are internal parts of that owner; no new registry, no per-step service, and no parallel removal tool is needed.

`@runlith/agent` owns the call's ending and keeping its answer, cancellation included. That boundary is part of the delivery: the current `ToolExecution.stoppedAnswer` drops read-back through `unretainedAgentToolOutput` and forces `unknown` onto a started mutation. What is needed is keeping the full answer through the standing output projection/store and telling a confirmed cancellation apart from an unknown outcome; one `ToolAnswer` out of delete is not enough. The decision stays the door's shared contract, with no branch by the delete name.

`@runlith/files` owns entry-identity reading, CAS, and the real removal of a file/link/special entry/empty directory. A missing file primitive appears here with a typed outcome, not as a `node:fs` walk in the door or an `rm -rf` call. Shared path-resolution diagnostics are fixed at their producer in `workspace/runtime.ts` and the file boundary; no local catch is added in delete guessing the resolution by the word Unknown.

The server `workspace` sets each entry's checkout and project; `change-record` stays the sole owner of intent, confirmation, authorship, and recovery after interruption. `agent-tools` uses `WorkspaceChanges`, never reads the server DB, and never recomputes authorship. The owner declares any lower-contract extension needed; callers and implementation change together.

Every removed file of a registered checkout passes the standing "queue → intent → check/remove → confirm" sequence. Successful entries, and only they, stay with the calling thread; an unremoved file never gets a false removal. A failed intent placement leaves that file on disk. A removal already performed when confirmation fails is called performed with pending accounting and recovers through the standing start mechanism; removing it again for confirmation is forbidden. Parallel Bash windows never hijack tool removals' attribution.

Inside one call paths may belong to different projects or lie outside checkouts. Each place's law and mode arrive through the standing mechanism before its mutation, with no false attribution of every entry to the project's home. When the checkout's own tree is removed, the needed place and HEAD are taken before its Git metadata vanishes; the project/checkout registry is never removed automatically. This is no bypass of the graph's service-storage protection in force.

Batching never turns `WorkspaceChanges.land` into a fictitious transaction over the FS: independent removals have their own outcomes. The implementation uses memory-bounded groups and the standing queue/lock acquisition order, without holding every file of the tree for the whole walk. Each actual group's change list is accepted whole under the standing contract. Directories and external files needing no line accounting never force reading all bytes.
## Errors and partial execution

Before the first mutation a malformed request refuses whole. Once started, one entry's error never undoes the already removed and never stops independent branches. A dependent parent with remaining entries stays in place. A failure of a shared resource needed to continue, or a cancellation, stops new removals and returns a partial outcome. No recycle-bin renames, no hidden rollback, no retries on an unchanged refusal.

Every unperformed entry carries a concrete path or an unexpanded branch, the stage (`expand`, `resolve`, `read`, `unlink`, `rmdir`, `record`), a stable cause, and the original OS diagnostic when there was one. Told apart: missing, no matches, non-directory in path, directory without `-r`, non-empty directory, access denied/operation not permitted, read-only FS, busy, version/place change, symlink loop, law refusal, record-write failure, and cancellation. The continuation hint follows the established cause; the tool never advises `sudo`, disk access, or retry on a guess.

`Unknown` is allowed only as an honest absence of classification: then the original code/errno/syscall/message stay, with why classification is unavailable. The wrapper never destroys them for `_tag` and never promises "nothing changed" when other targets are already removed. For the recorded macOS case a diagnosable outcome must be obtained; access to the folder itself may still refuse over a real OS restriction.

On stop the guarded record transition of the currently performed removal completes; further entries are untouched. `delete` accumulates a partial report in the concrete call's resource by `(caller, toolCallId)` and declares the standing `settleEffect`/`settled`: read-back after cleanup returns the established total, and the resource frees only after the terminal outcome's confirmed record, not on read-back reading. A large report uses the standing tool-output store, with no second authorship journal and no holding of every outcome in memory.

The door keeps read-back through the same full-output mechanism as an ordinary answer: the address and the remainder past the preview stay reachable through `read_tool_output`, also on cancellation. `cancelled` means the owner after cleanup established every started act's outcome and the unprocessed remainder's boundary; the `mutates` mark alone never turns that fact into `unknown`. When read-back is unavailable or at least one started act's outcome stays unestablished, the total is `unknown` with the known outcomes and an explicitly named gap — not "not removed". This changes the delivery and its read-back contract, not a guarantee already in place.
## The answer without a wall of a hundred diffs

One call gives one full structured report and a short feed summary: how many entries were removed, missing/unmatched under `-f`, skipped by the selected option, left with an error, and unprocessed; unexpanded branches read as an unknown count of children, not zero. For every performed/unperformed act the path, entry kind, link to the source operand, actual outcome, and record state (`recorded`, `outside`, `pending`) are kept. A deliberately skipped mount boundary reads apart from an error.

Removed paths are marked `shown/wrote` only on actual execution. One small text file keeps a useful diff; a tree never yields a diff per file in the main answer. `-v` switches on the detailed action list. The large list and every cause are kept whole in the standing tool outcome and reachable through `read_tool_output`; the visible-text limit explicitly names what is left, excluding nothing from execution. No repeat `delete` is needed to read the report.

Success means the whole request ran, honoring the explicitly selected `-f` and `--one-file-system`. Any unsuppressed error yields a machine-distinguishable failure with the same saved report, including on partially performed removal; the standing `ToolAnswer` ability to carry a refusal with the outcome is used. Pending accounting and an unknown outcome are never passed off as a fully confirmed success.
## Cost and delivery

The walk touches the selected roots and their children. Shared pattern prefixes walk together; a directory is never re-read per neighbour, and the tree is never re-scanned for claims, execution, counters, and output. Cost is set by visited entries and bytes genuinely needed for accounting, with no O(n²) identity search across all neighbours. No full contents of every file are held upfront. Heavy computation over an unbounded set follows the owner's standing worker contract; I/O and entry groups have an explicit bounded concurrency, independent of file count.

The spec sets no arbitrary limit on removed-file count or total tree size. Scaling checks measure and publish the sample size, time, and peak memory on the executing machine; never declaring a local second a universal guarantee. One call over 100 files never becomes 100 tool calls, a hundred processes, or a hundred full checkout walks.

The same delivery updates the schema, description, native/MCP delivery, the running call's projection, and the current behaviour documentation. Instructions route ordinary file, pattern, and tree removal into `delete`, removing the grounds for routing around it with Bash for mass removal. No machine `rm` ban and no rewriting of arbitrary foreign shell scripts are added. Already executing instructions update by standing notification; sleeping threads are never woken.

## Checkable completion

The public contract is checked through one tool call, the actual tree, and the ChangeRecord — not through private-helper calls or hint lines:

- A list of 100 files and overlapping patterns is removed in one call; only unselected entries remain, authorship facts never duplicate. The 100 is a check of the user's mass scenario, not a fixed size of every test.
- Patterns, hidden names, missing matches, literal metacharacters, spaces/newlines, a leading `-`, option order, and invalid input yield the described selection and outcome; a syntax error removes nothing.
- An empty directory, a tree with hidden/ignored children, a large external file, a symlink to a directory, a dangling symlink, and a removable special entry work without reading streams or following found links. Device-boundary options are checked at the platform owner, with no mount privileges demanded of an ordinary suite.
- One target's error, a branch-expansion refusal, and a new/replaced child keep the exact remaining data and a partial report; `-f` never turns them into success. A real system failure's diagnostic is never lost behind Unknown.
- Registered files of different checkouts get the right author; an external path reads as outside; a failure before removal creates no false fact, a failure after it and a stop recover through the standing mechanism. Checked through the record's public operations and the standing fixtures, with no new test API.
- A large answer keeps every outcome past the visible fragment, and partial execution and cancellation read apart from success by machine. A separate public scenario stops a started removal with a report past the visible limit: every established outcome and the unprocessed remainder finish reading through `read_tool_output`; a confirmed stop gives `cancelled`, an unavailable/incomplete read-back gives `unknown`. Confirming the terminal outcome, not reading the report, frees the call's resource. Native and MCP get one meaning, with no new removal implementation of their own on each door.

The minimal public checks of independent contracts are selected, and the standing CAS/recovery checks are reused; the full matrix is never multiplied by every option combination. Types are checked by the standing `bun run typecheck`; file scenarios and record checks stay in their integration/system layer and its budget. Checking by the operator is no completion condition.
