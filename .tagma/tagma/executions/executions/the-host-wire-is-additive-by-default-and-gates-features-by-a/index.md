---
id: 01a0f023-c81b-7a4c-bbe7-00ef3283ebae
title: The host wire is additive by default and gates features by announced capabilities; its version moves only for a breaking change and carries at most one previous release
ord: 41
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ef62-bd2c-75a6-9efa-3ad2b5f88bb9
sources:
  - kind: file
    ref: packages/execution-host/src/HostConnections.ts
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
  - kind: file
    ref: packages/executions/src/WireSession.ts
---
## 1 Outcome

A build that adds a field, a request or a subscription source to the host wire reaches the hosts that serve it and is refused locally, by name, for the hosts that do not. Nothing is copied per version: one set of schemas describes the wire, and what an older host lacks is a set of capability names. The version number moves only when a change cannot be read by the previous release, once per released build that carries one, and at most one previous release is carried at any time.

## 2 Problem

- **Per-version copies.** `wire35.ts`, `wire36.ts` and `wire37.ts` are 41, 11 and 6 lines of evidence and source schemas with the later fields cut out. `wire.ts` repeats the request union three more times (`LegacyRequest`, `PreviousRequest`, `IntermediateRequest`), holds three more host message and frame pairs, and each side selects among them with a chain of `version === …` tests: `decodeHost`, `decodeHostMessage` and `framed` in `WireSession.ts`, `decodeClient`, `encodeHostMessage`, `olderMessage` and the encoder choice in `HostConnections.ts`. The client also carries `normalizeLoad`, which rewrites a cut orphan shape back into the current one.
- **A version per commit.** Versions 36 and 37 stood in two commits and 38 in the working tree of one task, and none reached a build. `WIRE_FINGERPRINTS` pins a fingerprint for every number from 10 to 38: the number named "the shape of the two frames", so any field moved it.
- **A per-request table.** `REQUEST_FLOORS` gives every request kind the version that introduced it, and `unsupportedAt` refuses a call from that table. A request's need is declared far from the request.
- **Only one host is running.** The installed host was built from `e46a21b77c` and speaks wire 35 alone: its range is 35 to 35, and it carries a legacy 34 dialect for a client from before the preface. Nothing that speaks 34 is supported.
- **The cost of the copies is not needed.** Effect's schema parser ignores an object key the schema does not declare, on decode, and drops it on encode (`SchemaAST.ParseOptions.onExcessProperty` defaults to `"ignore"`). A peer that never heard of a new optional field already reads the message. The only repository code that sets `"error"` is the graph's block frontmatter and tag declaration, outside this wire.

## 3 What holds now

- **The negotiation.** Each side sends a preface `{ magic, wire: { min, max } }`. `highestCommon` names the version both speak, both sides stamp every frame `v` with it, and a frame of another version fails the frame's own decode (claims [[28f1b3c5]], [[d93d53b0]]).
- **The changes since 35 are all additive.** Measured against `e46a21b77c`: new optional keys (`ProcessWitness` micros, `ProcessUsageRow.memoryKind` and `footprintBytes`, `UsageRate.completeness`, `gaps`, `basis`, `detail`, `population.dropped`, `UsageMemory.kind` and `footprintBytes`), and whole new arms that only a caller that asked for them meets (the `Load` source, `LoadInterest` and `EndResidual` requests and answers, the `Load` event). No field was removed, retyped or made required, and no existing arm changed.
- **Measured.** The breaking shape (§4) of the wire-35 schemas at `e46a21b77c` and of this build's is the same hash, `sha256:a5c78d7e…`: nothing since 35 is breaking, and the number moves for the announcement alone.
- **Old hosts and new hosts already meet through the preface.** A 35 host offers 35 to 35; a client offering a wider range agrees 35.
- **The client refuses before it sends.** `WireSession.call` refuses a request whose floor is above the connection's version, with `HostRefused` carrying the refusal `UnsupportedCapability`, and the host refuses the same from the same table for a call by its request number.

## 4 Target model

**Additive by default.** A field a build adds to a message is optional. A message that carries a field the reader does not know decodes with it dropped, on both sides. The frames declare that explicitly on their own schemas as `parseOptions: { onExcessProperty: 'ignore' }`, so no reader picks its own strictness and no caller passes an option: the decoders in `WireSession` and `HostConnections` stay plain.

**Capabilities gate features.** `protocol/capability.ts` owns the vocabulary, `load` and `end-residual`, and one annotation, `needing(capability, schema)`, that a request arm or a subscription source arm declares beside its own schema. `requiredCapability(request)` reads it: the arm's own annotation, and for `Subscribe` the source arm's. The vocabulary names a feature a request can need; a datum a reader may find absent (`machine.memory`, a footprint) is an optional field, not a capability.

- **Announced at the welcome.** The host's `Welcome` carries `capabilities`, the names it serves, as an optional array of strings. Names this build does not know are dropped by the reader, so a later build may add one without the number moving. A host announces exactly what it serves. The client keeps the set as the connection's served set.
- **The previous release announces nothing.** `PREVIOUS_RELEASE = { version: 35, serves: [] }` is the set the released hosts of that version serve, frozen when it was released. A connection agreed at 35 serves that set. A capability a later build adds is absent from it by construction.
- **One refusal.** `unsupported(request, served)` answers `UnsupportedCapability` naming the capability, or nothing. The client applies it in `WireSession.call` before the request is encoded, so nothing reaches the socket, and `ExecutionClient` reports it as the `HostRefused` it already raises. The host applies the same function to the connection's served set, so a request a 35 client should not have sent is refused by its number, not by dropping the connection.

**The number means a breaking change.** `WIRE_VERSION` is raised only by a change a reader of the previous release cannot read: a field removed, retyped or made required; an arm removed or changed; the frame or the handshake changed. It is raised in the build that first carries such a change and not again until another does, so a number stands for a released breaking build, never for a commit. The number is 36, one over the running host's 35, because 36 is the build that introduces the announcement: a 36 peer treats a capability it was not told about as not served, where a 35 host was never asked.

**One previous release.** While a released host speaking 35 may be running, `WIRE_RANGE` is `{ min: PREVIOUS_RELEASE.version, max: WIRE_VERSION }`, and the one set of schemas reads both: 35 messages are additive under them, which the frozen corpus proves. Frames carry `v` naming the connection's agreed version. When no supported host speaks 35, `PREVIOUS_RELEASE`, the 35 section of the corpus and the range's floor are deleted whole, and the compiler names every place that read them.

**Checked, not remembered.** Four tests fail the build:

1. **The breaking shape is pinned.** `breakingShape` projects the two frames and the preface to what a previous reader depends on: required properties only, no `v`, and no arm that declares a capability. Additive changes leave it unchanged. It is pinned per version in `WIRE_FINGERPRINTS`. A change that moves it names `WIRE_VERSION` and the number to pin, in the same change.
2. **The released corpus reads under the current schemas.** `wireCorpus.json` holds the messages of the previous release, one per arm at least and frozen: each decodes under the current codecs and re-encodes to the identical text, so what a released host says is read and what the current schemas say to it is what it said. The current version's corpus is appended to and never edited once a build carrying it is released.
3. **The corpus covers the arms.** Every request, answer and event arm that declares no capability has a message in the previous release's corpus, and none that declares one has.
4. **Unknown fields are ignored at depth.** A corpus message with unknown keys added at several depths decodes to the same value, and a capability the reader does not know in a `Welcome` is dropped.

The check covers what the corpus exercises: an optional field that no frozen message carries is protected by review, not by a test, and that limit is stated in the claim.

**What goes.** `wire35.ts`, `wire36.ts`, `wire37.ts`; the per-version request, answer, message and frame unions; `REQUEST_FLOORS` and `unsupportedAt`; `normalizeLoad`, `olderMessage` and the version-selecting chains on both sides; the no-preface opening for a client from before the preface (`hostOpening`, `ClientOpening.Legacy`, `LEGACY_WIRE_VERSION`, the legacy stamp scalar) because no supported host speaks 34; and the inventory-based fallback `ExecutionClient.load` used against a host without `Load`, which measured only what the inventory carried. Against a 35 host `load` is refused locally.

## 5 Owners and boundaries

- **`executions/protocol`.** `capability.ts` (new) owns the vocabulary, the annotation and the served set. `wire.ts` owns the version, the range, `PREVIOUS_RELEASE`, `requiredCapability`, `unsupported`, the frames and the welcome. `artifact.ts` keeps `WireRange` and `highestCommon`, which negotiation and preflight share.
- **`WireSession` and `ExecutionClient`.** They keep the served set of their connection and refuse before sending. The adapter for a host without `load` is deleted.
- **`HostConnections`.** It announces at welcome, stamps frames with the agreed version and refuses a call the connection does not serve.
- **The server.** It sees the refusal as it sees any host refusal, typed, and decides what to show; nothing in the server names a wire version.

## 6 Rejected

- **A schema module per version, sliced.** It is what stands, and the cost grows with every build: each cut is a place the next field is forgotten.
- **A version per commit or per feature.** It makes the number a build counter, and a host of an earlier commit refuses a client that differs by one optional field.
- **A per-request table of versions.** It states a need far from the request and needs the number to move for an additive request.
- **Announce in the registration file.** The file is written at boot and read before any connection, but a capability is a fact of the process that answers, and the stamp would need a format change for something the welcome carries. Nothing needs the set before a connection.
- **A capability for every optional datum.** A reader already sees an absent optional field; a capability nothing needs is a name to keep in step.

## 7 Acceptance

- `wire36.ts` and `wire37.ts` are gone, `wire35.ts` is replaced by `PREVIOUS_RELEASE`, `WIRE_VERSION` is 36 and `WIRE_RANGE` is 35 to 36.
- A server of this build connected to a host of the previous release, replayed from the frozen corpus, lists the inventory, reads a byte range and stops an execution with the frames of wire 35, and `load` and `end-residual` are refused with `UnsupportedCapability` before anything reaches the socket: a listener records the hello and no call.
- A host of this build agrees 35 with a client that offers 35 alone, answers it in 35, and refuses a `LoadInterest` or `EndResidual` it sent.
- Each of the four checks fails on the change it names: a required field added, an optional field removed from an exercised message, a gated arm's annotation dropped, and a strict parse option.
- `wire.ts` holds fewer non-import lines than before.

## 8 What becomes of what stands

- **Rewritten:** [[d93d53b0]] (the number names the breaking shape, and the corpus and capabilities carry the rest), [[28f1b3c5]] (the frame's version is the connection's agreed one, refused by the range in the decode and by the session against the agreed number), [[e3f740ce]] (the sources, with `Load` and the capability it needs), and the claims over `ExecutionClient`'s adapter for a host without `load`, which end.
- **New claims:** the capability vocabulary and its annotation; what a welcome announces and what the previous release announces; the frozen corpus and the four checks with their limit; `WireRange` and `highestCommon` as the negotiation both the wire and preflight use.
- **Task [[c251e820]]:** its wire half, removing the carried codec, is done here for 34; its store half is unchanged.
- **[[b5f88bb9]] §10:** a server over an older host no longer labels resident figures from the inventory; the load subscription is refused locally with the capability named, and the surfaces say the host must be replaced.

## 9 Order

1. This decision.
2. The protocol: `capability.ts`, the gate, the single frames, the welcome, the frozen 35 corpus generated from the schemas of `e46a21b77c`, and the four checks.
3. The client and the host sessions on the single frames and the served set; deletions.
4. The claims, and this decision closed into them.

## 10 Contract

- **Shape.** `Welcome.capabilities` is new and optional. `UnsupportedCapability` gains an optional `capability`. `Subscribe.source`, the requests and the answers are unchanged for 35 readers; `Load`, `LoadInterest`, `EndResidual` and the `Load` event stay arms a 36 client asks for by name.
- **Version.** 36; the range is 35 to 36 while a 35 host may run.
- **Compatibility.** A 35 host and this client agree 35; a 35 client and this host agree 35; neither is asked for anything it does not serve. A frame stamped with a version outside the range is refused by its decode, and one inside the range but not the connection's agreed number is refused as skew.

## 11 Stored data

out: nothing stored is a wire message. The registration's artifact stamp keeps `wire` and `range`; a stamp without a range, written by a host that speaks 34 or earlier, reads as incompatible in preflight as it does today, and the bundle manifest formats are unchanged.

## 12 Who may do what

The capability gate is not an authorization: roles, custody and the epoch are decided as before, from the connection. A recovery connection is offered the same served set, and its admission by role is unchanged. A client that sends a request the host does not serve gets a refusal for that request; nothing widens what a role may do.

## 13 Long-lived things

- The served set belongs to a connection and is read once, from its welcome. A reconnect reads it again, so a host replaced between two connections is learned from the new welcome.
- The previous release's entry lives until no supported host speaks it. Deleting it is one change whose compile errors and failing corpus test name the remainder.

## 14 Bounded resources

The welcome grows by the capability names, tens of bytes. The corpus is bounded by one message per arm for the previous release and for the current version; it is data, read by the tests, never by a running process.

## 15 Rollout

The installed host keeps running at 35 until it is replaced. A server of this build talks to it for inventory, reads and stops and refuses `load` and `end-residual` locally, naming the capability, until the host is replaced by the usual update. A new host with an old server agrees 35 through the preface.

## 16 Failures

- A `capabilities` array that is not strings makes the welcome unreadable, as any malformed welcome does.
- A 36 host that announces nothing serves only what needs no capability.
- A connection that dies reconnects and reads the set again; a request refused for a missing capability is never sent and so is never uncertain.
- A frame whose `v` is outside the range fails its decode; one inside the range and not agreed is a version skew fault.

## 17 Observability

- The refusal names the capability, so the surface can say what the host lacks.
- The four checks run with the wire's tests; a moved shape names the number to pin.
- The connection's served set is the one place a reader looks for what a host serves.

## 18 Divergence

The premise of §2 and §4 was wrong: the host that runs is not `e46a21b77c` at 35 but the installed build `d0caeed2ef`, wire 37 (range 35–37). What was built instead:

- `WIRE_VERSION` is 38 and `PREVIOUS_RELEASE` is `{ version: 37, serves: [] }`; the range is 37–38. Wire 35 has no host and is deleted whole, with its corpus section. The number 38 still stands for the announcement; the breaking shape pinned for it is the one 35 pinned.
- The previous release serves no capability under this build's contracts, so `load` and `end-residual` are both refused locally on the running host and the surface says the host must be replaced. The reason is in that build's code: `darwinProbe.ts#usageRow` builds `identity: witness === undefined ? { pid } : { pid, witness }` and spreads `parent` only when the listed parent is addressable, so its installation rows can lack a start witness or a parent, which this build's `InstallationProcess` requires, and its `Load` event would be unreadable. No half reading is kept: a `Load` from it is never subscribed to.
- A host announces the capabilities it serves, not the whole vocabulary: `load` only where a native usage reader loaded on darwin under a usage policy, `end-residual` always ([[02451def]]). `HostConnections` takes that set and gates both the welcome and the refusal of a call by it.
- The byte framing (`encodeFrame`, `frameReader`, `takeFrames` and their types) moved from `wire.ts` to `frames.ts` so `wire.ts` stays under the line ceiling; importers name `protocol/frames`.
- The 38 corpus carries the current memory shape: `memory` stays the previous release's union, and the footprint is the sibling `footprint` field, so a previous-release client reads this host's inventory ([[ed976314]]).
- The frozen corpus is that build's own frames and arms, generated from its schemas taken from that commit (arbitrary samples per arm). It carries no `Load` source, `LoadInterest` or `Load` event, since nothing of `load` is read from it, and its arm-coverage check expects exactly the arms no capability gates.
