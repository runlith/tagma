---
id: 01a0eed5-adb6-7d6f-971c-a67a083d37f1
title: An import crosses into another module only over a declared relation and through an entry open to the importer
ord: 10
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "graph-remote -> @runlith/git private @ apps/tagma/server/src/graph-remote/exchanger.ts",
          "fix": "Import through an entry `@runlith/git` opens to `graph-remote` (`packages/git/src/vocabulary.ts`), or open one covering `packages/git/src/Git.ts` with `set_module`.",
          "line": 3,
          "path": "apps/tagma/server/src/graph-remote/exchanger.ts",
          "said": "imports `@runlith/git/Git` of module `@runlith/git`, which no entry of `@runlith/git` opens to `graph-remote`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "graph-remote -> @runlith/git private @ apps/tagma/server/src/graph-remote/git.ts",
          "fix": "Import through an entry `@runlith/git` opens to `graph-remote` (`packages/git/src/vocabulary.ts`), or open one covering `packages/git/src/Git.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/server/src/graph-remote/git.ts",
          "said": "imports `@runlith/git/Git` of module `@runlith/git`, which no entry of `@runlith/git` opens to `graph-remote`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "graph-remote -> @runlith/git private @ apps/tagma/server/src/graph-remote/layer.ts",
          "fix": "Import through an entry `@runlith/git` opens to `graph-remote` (`packages/git/src/vocabulary.ts`), or open one covering `packages/git/src/Git.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/server/src/graph-remote/layer.ts",
          "said": "imports `@runlith/git/Git` of module `@runlith/git`, which no entry of `@runlith/git` opens to `graph-remote`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/CallChip.svelte",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Host.ts` with `set_module`.",
          "line": 6,
          "path": "apps/tagma/app/src/lib/features/calls/CallChip.svelte",
          "said": "imports `@runlith/layer/Host` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/CallPane.svelte",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Host.ts` with `set_module`.",
          "line": 9,
          "path": "apps/tagma/app/src/lib/features/calls/CallPane.svelte",
          "said": "imports `@runlith/layer/Host` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/Calls.svelte.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Scope.ts` with `set_module`.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/Calls.svelte.ts",
          "said": "imports `@runlith/layer/Scope` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/Follower.svelte",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/svelte/App.svelte.ts` with `set_module`.",
          "line": 4,
          "path": "apps/tagma/app/src/lib/features/calls/Follower.svelte",
          "said": "imports `@runlith/layer/svelte/App.svelte` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/layer.svelte.test.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/svelte/test.svelte.ts`, `packages/layer/src/testing.svelte.ts`, `packages/layer/src/testing.ts`, `packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Layer.ts` with `set_module`.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/layer.svelte.test.ts",
          "said": "imports `@runlith/layer/Layer` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/query private @ apps/tagma/app/src/lib/features/calls/layer.svelte.test.ts",
          "fix": "Import through an entry `@runlith/query` opens to `app-calls` (`packages/query/src/test-utils/observe.svelte.ts`, `packages/query/src/testing.ts`), or open one covering `packages/query/src/repo.ts` with `set_module`.",
          "line": 5,
          "path": "apps/tagma/app/src/lib/features/calls/layer.svelte.test.ts",
          "said": "imports `@runlith/query/repo` of module `@runlith/query`, which no entry of `@runlith/query` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/layer.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Layer.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/layer.ts",
          "said": "imports `@runlith/layer/Layer` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/library/CallView.svelte",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Host.ts` with `set_module`.",
          "line": 6,
          "path": "apps/tagma/app/src/lib/features/calls/library/CallView.svelte",
          "said": "imports `@runlith/layer/Host` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/library/CallsPage.svelte",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Router.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/library/CallsPage.svelte",
          "said": "imports `@runlith/layer/Router` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/library/Library.svelte.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/key.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/library/Library.svelte.ts",
          "said": "imports `@runlith/layer/key` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/library/Repo.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/key.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/library/Repo.ts",
          "said": "imports `@runlith/layer/key` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/query private @ apps/tagma/app/src/lib/features/calls/library/Repo.ts",
          "fix": "Open an entry of `@runlith/query` covering `packages/query/src/types.ts` to `app-calls` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/library/Repo.ts",
          "said": "imports `@runlith/query/types` of module `@runlith/query`, which no entry of `@runlith/query` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/links.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/key.ts` with `set_module`.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/links.ts",
          "said": "imports `@runlith/layer/key` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/moment.svelte.test.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/svelte/test.svelte.ts`, `packages/layer/src/testing.svelte.ts`, `packages/layer/src/testing.ts`, `packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Layer.ts` with `set_module`.",
          "line": 4,
          "path": "apps/tagma/app/src/lib/features/calls/moment.svelte.test.ts",
          "said": "imports `@runlith/layer/Layer` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/query private @ apps/tagma/app/src/lib/features/calls/moment.svelte.test.ts",
          "fix": "Import through an entry `@runlith/query` opens to `app-calls` (`packages/query/src/test-utils/observe.svelte.ts`, `packages/query/src/testing.ts`), or open one covering `packages/query/src/repo.ts` with `set_module`.",
          "line": 6,
          "path": "apps/tagma/app/src/lib/features/calls/moment.svelte.test.ts",
          "said": "imports `@runlith/query/repo` of module `@runlith/query`, which no entry of `@runlith/query` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/piece.svelte.test.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/svelte/test.svelte.ts`, `packages/layer/src/testing.svelte.ts`, `packages/layer/src/testing.ts`, `packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/key.ts` with `set_module`.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/piece.svelte.test.ts",
          "said": "imports `@runlith/layer/key` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/piece.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/key.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/piece.ts",
          "said": "imports `@runlith/layer/key` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/layer private @ apps/tagma/app/src/lib/features/calls/surfaces.svelte.test.ts",
          "fix": "Import through an entry `@runlith/layer` opens to `app-calls` (`packages/layer/src/svelte/test.svelte.ts`, `packages/layer/src/testing.svelte.ts`, `packages/layer/src/testing.ts`, `packages/layer/src/Point.ts`, `packages/layer/src/svelte/PointView.svelte`, `packages/layer/src/svelte/payload.ts`, `packages/layer/src/svelte/ShownPayload.svelte`), or open one covering `packages/layer/src/Layer.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/app/src/lib/features/calls/surfaces.svelte.test.ts",
          "said": "imports `@runlith/layer/Layer` of module `@runlith/layer`, which no entry of `@runlith/layer` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/query private @ apps/tagma/app/src/lib/features/calls/library/Shelf.svelte.ts",
          "fix": "Open an entry of `@runlith/query` covering `packages/query/src/types.ts` to `app-calls` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 3,
          "path": "apps/tagma/app/src/lib/features/calls/library/Shelf.svelte.ts",
          "said": "imports `@runlith/query/types` of module `@runlith/query`, which no entry of `@runlith/query` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-calls -> @runlith/primitives private @ apps/tagma/app/src/lib/features/calls/sendHint.ts",
          "fix": "Open an entry of `@runlith/primitives` covering `packages/primitives/src/tooltip.svelte.ts` to `app-calls` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 1,
          "path": "apps/tagma/app/src/lib/features/calls/sendHint.ts",
          "said": "imports `@runlith/primitives/tooltip.svelte` of module `@runlith/primitives`, which no entry of `@runlith/primitives` opens to `app-calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "calls -> agent private @ apps/tagma/server/src/calls/threads.ts",
          "fix": "Import through an entry `agent` opens to `calls` (`packages/agent/src/protocol/birth.ts`, `packages/agent/src/agent/AgentPhase.ts`, `packages/agent/src/agent/AgentEvent.ts`, `packages/agent/src/agent/callProgress.ts`, `packages/agent/src/agent/contracts.ts`, `packages/agent/src/agent/skillReferences.ts`, `packages/agent/src/agent/tool.ts`, `packages/agent/src/agent/ToolArguments.ts`, `packages/agent/src/tool/display.ts`, `packages/agent/src/tool/page.ts`, `packages/agent/src/agent/ToolCatalog.ts`, `packages/agent/src/agent/ToolOutputSpool.ts`, `packages/agent/src/collaboration/agentLabel.ts`, `packages/agent/src/collaboration/CollaborationConfig.ts`, `packages/agent/src/permissions/vocabulary.ts`, `packages/agent/src/protocol/http.ts`, `packages/agent/src/protocol/realtime.ts`, `packages/agent/src/thread/cache/ThreadCacheWarmth.ts`, `packages/agent/src/thread/persisted.ts`, `packages/agent/src/thread/storage/inbox.ts`, `packages/agent/src/thread/storage/settlement.ts`, `packages/agent/src/transcript/attachments.ts`, `packages/agent/src/transcript/entries.ts`, `packages/agent/src/transcript/kinds.ts`, `packages/agent/src/transcript/entryNames.ts`, `packages/agent/src/transcript/eventFold.ts`, `packages/agent/src/transcript/feedFold.ts`, `packages/agent/src/transcript/keepWarm.ts`, `packages/agent/src/transcript/live.ts`, `packages/agent/src/transcript/page.ts`, `packages/agent/src/transcript/parts.ts`, `packages/agent/src/transcript/rows.ts`, `packages/agent/src/transcript/TranscriptFold.ts`, `packages/agent/src/transcript/cap.ts`, `packages/agent/src/thread/compaction/limit.ts`, `packages/agent/src/thread/compaction/strategies.ts`, `packages/agent/src/collaboration/team.ts`, `packages/agent/src/tool/refusal.ts`, `packages/agent/src/agent/door/outcomeText.ts`, `packages/agent/src/thread/Approvers.ts`, `packages/agent/src/transcript/openText.ts`), or open one covering `packages/agent/src/thread/ThreadBorder.ts` with `set_module`.",
          "line": 1,
          "path": "apps/tagma/server/src/calls/threads.ts",
          "said": "imports `@runlith/agent/thread/ThreadBorder` of module `agent`, which no entry of `agent` opens to `calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "calls -> threads private @ apps/tagma/server/src/calls/threads.ts",
          "fix": "Import through an entry `threads` opens to `calls` (`apps/tagma/server/src/threads/contract/`), or open one covering `apps/tagma/server/src/threads/turns/acts.ts` with `set_module`.",
          "line": 9,
          "path": "apps/tagma/server/src/calls/threads.ts",
          "said": "imports `../threads/turns/acts.js` of module `threads`, which no entry of `threads` opens to `calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "calls -> @runlith/echo private @ apps/tagma/server/src/calls/layer.ts",
          "fix": "Import through an entry `@runlith/echo` opens to `calls` (`packages/echo/src/canceller.ts`), or open one covering `packages/echo/src/sonora/open.ts` with `set_module`.",
          "line": 38,
          "path": "apps/tagma/server/src/calls/layer.ts",
          "said": "imports `@runlith/echo/sonora` of module `@runlith/echo`, which no entry of `@runlith/echo` opens to `calls`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/developer/build.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/verbs.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 7,
          "path": "apps/tagma/server/src/composition/developer/build.ts",
          "said": "imports `../../graph-remote/verbs.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/developer/catalog.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/contract/wire/module.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 2,
          "path": "apps/tagma/server/src/composition/developer/catalog.ts",
          "said": "imports `../../graph-remote/contract/wire/module.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/developer/modules.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/graph-remote.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 3,
          "path": "apps/tagma/server/src/composition/developer/modules.ts",
          "said": "imports `../../graph-remote/graph-remote.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/release/build.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/verbs.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 7,
          "path": "apps/tagma/server/src/composition/release/build.ts",
          "said": "imports `../../graph-remote/verbs.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/release/catalog.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/contract/wire/module.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 2,
          "path": "apps/tagma/server/src/composition/release/catalog.ts",
          "said": "imports `../../graph-remote/contract/wire/module.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "composition -> graph-remote private @ apps/tagma/server/src/composition/release/modules.ts",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/graph-remote.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 3,
          "path": "apps/tagma/server/src/composition/release/modules.ts",
          "said": "imports `../../graph-remote/graph-remote.js` of module `graph-remote`, which no entry of `graph-remote` opens to `composition`"
        },
        {
          "commit": "1841189c8260971ce866cb0f849577acc30e43ad",
          "fingerprint": "app-graph -> graph-remote private @ apps/tagma/app/src/lib/features/graph/RemoteCard.svelte",
          "fix": "Open an entry of `graph-remote` covering `apps/tagma/server/src/graph-remote/contract/wire/remote.ts` to `app-graph` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 6,
          "path": "apps/tagma/app/src/lib/features/graph/RemoteCard.svelte",
          "said": "imports `@tagma/server/graph-remote/contract/wire/remote` of module `graph-remote`, which no entry of `graph-remote` opens to `app-graph`"
        }
      ],
      "inspection": "modules",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: .
---
A module's boundaries — its root, entries, relations and `order` — stand on its #module card, and `set_module` changes them. Inside a module, imports run only down the card's `order`. Only test code enters another module's `testing` entry; production relations stand in an acyclic order, and a test-only relation (`imports-tests`) does not close a cycle; every file of the region belongs to a module.
