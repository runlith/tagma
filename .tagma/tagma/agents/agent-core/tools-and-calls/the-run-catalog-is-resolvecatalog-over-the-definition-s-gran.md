---
id: 01a11926-4535-762c-a8e7-af3319daf275
title: "The run catalog is resolveCatalog over the definition's grant: nothing else adds or removes a tool"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-911fc86fbefa
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentScope.ts
  - kind: file
    ref: packages/agent/src/catalog/resolveCatalog.ts
---
The catalog the model sees and the door executes is built by one function: `resolveCatalog(definition, profile, contributions, verdicts)`. It is called by `agentCatalog` in `AgentScope.ts`, and that by run preparation `ThreadAgent.prepare`, the restored-context boundary, `ThreadAgent.toolCatalog` (the path outside a run), and `AgentRunner` without a ready catalog (a run outside a thread). Preparation builds the `ThreadContext`, resolves sources and the initial catalog; a changed declared catalog revision rebuilds it with the same function before the next native step or hosted step, without changing the context generation. The current hosted catalog is read through the handle method, so copying the handle does not freeze it. While the revision stands, the turn orientation (`orient`, on the hosted road — every turn opening), the native loop (`start`), and the hosted road (`host`) read this one assembly, so the deferred-tool inventory in the turn context is the run catalog's deferred names — runtime sources included. Contributions arrive through one seam, `toolSupply` in `supply.ts`: registry sources, the output scope, and `tool_search`. The run carries a supply plan (`ThreadSupplyPlan`), not ready contributions: the agent resolves registry sources against its `ThreadContext` (`supplied`) at preparation, at catalog-revision change, and on every restored-context boundary, so a source needing the thread context reads it from the request, and a new context generation mid-run builds a new catalog. No other place adds or removes a tool. A name outside the catalog is refused by the door as unknown: on both the native loop and the hosted road, `ask_user` included — `ThreadHosting.performed` checks the catalog before deciding whether it is a question or a call.

**Precedence.** First the grant's `deny` and the policy's unconditional `deny` (`PermissionPolicy.verdict: 'deny'` without `subjects`), then the grant, then the profile. Step directives (`exclude`, `restrict`, `require`, `request`) work over the ready catalog and cannot return what was not admitted. A `deny` with `subjects` does not touch the catalog: the door refuses the concrete call with a typed refusal (`permissionRefusal`) in any mode, `bypass` included.

**Grant is the only source of what an agent has.** Either a whole source is granted, or names listed from it. The definition's own tools come as a source with the agent's id; `new Agent` without a `grant` receives only those. Tagma's built-in agents list their capability sources (`narrowable`) and the conversational `user-question`, `output`, and `tool_search` sources (`standing`) in the definition, so the user's set stays the same while a narrow definition (`look`, `act`) receives nothing beyond what is granted.

**Profile only narrows.** `tools` is a whitelist of names across the whole catalog, except what is granted as `standing`: the definition itself declares what survives any list (in built-ins — the conversational sources and `send_message`), so an agent file with `tools:` names only what it wants on top. `sources` is a whitelist among sources marked `narrowable`. A profile never adds. The restored-context name list (`ThreadContextEvidence.tools`) pins the snapshot of the first restored catalog. When the runtime revision changes, that temporary list is lifted: otherwise a capability switched off in the saved snapshot would never return after being switched on. The grant and an explicitly set profile keep limiting the new catalog.

**`tool_search` is a derived contribution.** It derives from the already-admitted catalog and appears only while deferred tools remain; grant and `deny` apply to it, `profile.tools` does not — otherwise a profile naming a deferred tool would leave it without search.

**The source registry is the `ThreadToolRegistry` service.** The owner (collaboration, resources, user questions, and in Tagma the `skills` and `mcp` capability sources) registers a source in its own layer; registration lifts with the scope's layer; one id in two registrations refuses `ToolSourceCollision` with both owners. A source declares `names` — everything it can provide — and the port builds an implementation only for the granted ones: the rest reach the resolver as bare names (`declined`) and land in `withheld`. `names` must match what the source builds; the source's test holds that.

**`withheld`** — contributions the catalog did not admit, with reason `denied`, `denied-by-policy`, `not-granted`, or `not-in-profile`; it lives in `AgentScope`, in run handles and hosted-run handles. One name in two admitted contributions refuses `CatalogNameCollision` with both sources.

**A completed call survives a scope change.** The door returns the recorded outcome by `toolCallId` earlier than the catalog decides whether such a tool still exists (`AgentToolDoor.receipt`); the same id under a different name or input refuses `AgentToolCallReused`. The `Regenerated` refusal stays with a call that has not completed yet.
