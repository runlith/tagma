---
id: 01a0e43d-37cc-7df3-b45f-3bd8e96ac87e
title: "Independent review of section 7 server cards v3: Astra's follow-up (V3-1…V3-5, the two open edges, F3)"
ord: 3
---
# Section 7 v3 — Astra follow-up, retained synthesis

Verdict: **holds after fixes**. This is the launcher's retained synthesis of Astra's independent report, not a replacement for the signed report. The reviewer did not read Sol's results. Do not edit the reviewed server file while Sol's second pass is still in progress.

## Closed or substantially improved

- Early release-N vocabulary refusal and release-N+1 activation now follow section 9.
- Task shells before debt, separate M1/M2/M3/N and incoming-consumer narrowing are the right concepts, but the generated graph still omits dependencies.
- ThreadExecution ownership/direction, native compaction/refresh, reload-source ownership and graph-owned storage paths are corrected.
- Registry policy publication and queue downgrade preflight are now present as target contracts and distinct from credential rollback.
- Canonical operation ids, RequestKey and recorded/legacy landed are aligned.
- Prior concrete naming errors were corrected; remaining naming candidates are openly identified.

## V3-1: generated milestones omit disappearing door edges and K5a

The frame promises target reverse relations plus actual door imports, but control/milestones.mjs:8–10,29 uses RELATIONS only. graph N waits for composition M2 but not http/socket/cli M2; composition M2 does not prove those door cuts are done. Use the union of the reconciled incoming physical imports and target relations, including edges intended to disappear, or explicit M2 prerequisites for each current incoming door.

K5a exists in prose but not among the 121 tracked nodes. Make it an early invocation milestone and a prerequisite of every step publishing renamed operations, breaking answers or retiring typed routes. composition M2 may remain a conservative final pass, not a substitute for those edges. Avoid self-dependency for composition N.

## V3-2: D4 deletes the old external representation before its runtime can read the new one

W2a only moves definitions. D4 removes external thread/thread while new runtime and collaboration adapters arrive at W6. Existing HarnessBirths.create/adopt/spawn (:65–98,142–177) and HarnessSessionStore.readIn/standing/change (:50–81,158–196) still read/write the removed shapes. Phase publisher changes do not make them runnable.

Add D4-runtime-ready: minimal thread catalog/mandate, external birth/session readers/writers and rollout participant conversion in their current code locations, switched atomically with D4 before admission resumes. W6 later moves working implementations. Do not restore native rows for external threads. When changing the kernel port, remove the hidden native default there and have composition explicitly provide the old runner through a required port during transition.

Resolve transitional binding lifetime contradictions: X M2 completes X's own implementations; bindings supplied by upper I remain until I's declared M1. threads M3 cannot demand the disappearance of the entire harness/ and thread/ directories before native/external M2.

## V3-3: platform's final entries contradict its public file map

N restricts entries to contract/, but cards publish platform/declarations/* and platform/voice/plain.ts/answer.ts for other modules. Put the defining public machinery and voice primitives in the right contract/wire or contract/service files, leaving implementation internal. Use the accepted assembly/CLI/test entry distinctions; no blanket platform entry and no re-export facade.

## V3-4: a cross-file claim is not necessarily several claims

Section 7.4.6 now mandates splitting a claim covering several output files. That contradicts section 8.8: one indivisible invariant may require several sources/owners. Retain one claim with several narrow sources when it states one guarantee; split only independent assertions. Change anchors and parentage through supported operations without inventing a supersession for a source move.

## V3-5: exact send/receive remains incomplete

- read_installation_status is assigned to external-harnesses at line 951, but the sender still assigns it to installation at line 956. Correct the stale sender.
- control.mjs mentions/hit:39–54 recognizes a token anywhere, even in risks/leaves. Its 891-owner count and lexical coverage do not prove a source-target pair or send/receive agreement. Provide structured mapping or equivalent exact evidence.
- Eight files in group rows are not intrinsically wrong: a definite code/* preserving stems or a fully retired route group can be sufficient. Enumerate the eight with the applicable rule, not eight artificial cards.
- api/agents.ts#skills and the answer shapes still unexamined at line 1832 need the designer's decision before builders receive the card.

## Resolve the two named edges without fake owners

### executions → http

The callers need actorOf, not general HTTP helpers: terminalChannel.ts:24, commandBytesChannel.ts:6, definition http/handlers/terminals.ts:33–36. Move this execution-admission conversion into executions/terminals/access.ts and switch HTTP and socket callers together in K2. Preserve the native-session-without-project refusal (protocol/terminalActor.ts:9–13). ActorRef's neutral identity is not a substitute for domain admission. Generic HTTP answered remains transport framing.

### native-harness → installation

Separate two concerns:
- vacuumText and the vacuum branch of graphToolText (projection/toolAnswer.ts:143,427–435) belong to installation's operation voice. Supply them by manifest rather than an import from native-harness.
- SourceCut used in ToolReflectionFiled.receivedBy (protocol/toolResult.ts:11,207) is process provenance, not the vacuum/restart operation. It is also used by graph's Reflection/Graph/GraphPool/MirrorBuilder. Split protocol/source.ts by meaning: the shared immutable ProcessProvenance shape (startedAt, revision/head/dirty) in platform; measurement in installation; InstallationCut, Source/Restart and restartAsk in installation; reflection receipt and voice in graph, with provenance passed as a value. No native-harness→installation edge is necessary.

## Proposed narrow F3 amendment, not permission to manufacture splits

Keep the syntactic candidate measured. Gate excludes only exact paths explicitly listed with one subject and a reason for a short context-dependent stem. This is not a global exemption for all reads/rows/acts and not moving F3 entirely to watch. Resolve all 18 candidates before P5; rename an unexplained faces.ts by the actual public contract where appropriate. f3scan.mjs's inline-range regex is not measurement of every final file or a semantic decision.

F4 separately remains: the terminals/start.ts target combines L236–661 and L2438–2649, 638 source lines before any new header. If this is one lifecycle, propose a justified bounded allowance, not a split to meet a number. These are explicit amendments to accepted naming policy, to be reconciled by the launcher rather than delegated to the first builder.

## Coverage

Follow-up read of the corrected frame, affected cards and receivers, section 7.6.1, all three control scripts and needed JSON; full reads of the additional evidence files HarnessBirths, HarnessSessionStore, terminal handlers/channels, terminalActor, source, toolResult and toolAnswer. This is not an independent reread of all 891 files. Scripts were read, not run, because this reviewer was not allowed to overwrite artifacts. Counts/acyclic outputs remain the author's measurements; missing dependencies are established from the generator and JSON. No files, graph, DB, tests, typechecks, probes, load or child agents. Package/app/desktop cards and the performance addendum were not reviewed.
