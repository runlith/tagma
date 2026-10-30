---
id: 01a0ea9b-790b-786c-9051-1143144dfedc
title: A type shared by modules lives in the lowest module that uses it, and every other module imports it from there — never a copy, alias, or second declaration
ord: 7
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [
        {
          "fingerprint": "repeated-declarations repeated object:7596c301992ff7cb: apps/tagma/app/src/lib/features/executions/terminal/links.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9d0d6b2865df1af1:de2b55de1d78 apps/tagma/app/src/lib/features/executions/worktrees/Terminals.svelte.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated literals:430f57c6c06a1f8d: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:94060be1995795cd: apps/tagma/app/src/lib/features/speech/dictation/chord.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated literals:0bbcb0fdb836c05c: apps/tagma/app/src/lib/features/speech/values.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:099c3d9904a29237: apps/tagma/app/src/lib/features/threads/Draft.svelte.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:c4774d388f9f2f0c: apps/tagma/app/src/lib/features/threads/native/modelWords.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:b7c845eefc10b765: apps/tagma/desktop/src/bridge.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:DiffEntry apps/tagma/inspection/src/core/node/gitTrees.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Ast apps/tagma/inspection/src/core/signature.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:DriverId apps/tagma/server/scripts/profile-runtime.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Parsed apps/tagma/server/src/browser/engine/analysis.worker.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Window apps/tagma/server/src/browser/engine/analysis.worker.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Remote apps/tagma/server/src/browser/engine/console.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Preview apps/tagma/server/src/browser/engine/console.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Property apps/tagma/server/src/browser/engine/console.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Models apps/tagma/server/src/browser/engine/insights.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Request apps/tagma/server/src/browser/engine/insights.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Critical apps/tagma/server/src/browser/engine/insights.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:b7c845eefc10b765: apps/tagma/server/src/browser/engine/target.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ShapeAct apps/tagma/server/src/change-record/contract/service/shape.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Prepared apps/tagma/server/src/change-record/record/commandRows.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:WorkOwners apps/tagma/server/src/composition/callOwners.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ServedMeasurement apps/tagma/server/src/composition/http/status.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ServedMachineWorld apps/tagma/server/src/composition/http/status.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:InspectionsInstalled apps/tagma/server/src/enforcement/serving.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:54b4e6d2b9514b74: apps/tagma/server/src/enforcement/voice.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:54b4e6d2b9514b74: apps/tagma/server/src/executions/voice/commandRules.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:556efffd2ca42ed2: apps/tagma/server/src/external-harnesses/adapter/input.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:927195374e64d86b: apps/tagma/server/src/external-harnesses/birth/selection.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Driving apps/tagma/server/src/external-harnesses/sessions/drive.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:BlockEnd apps/tagma/server/src/graph/contract/service/work.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Spawner apps/tagma/server/src/installation/cut/notarize.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Spawner apps/tagma/server/src/installation/cut/release.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Failed apps/tagma/server/src/landing/contract/service/mergeGit.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:42f32713f999dd37:ce496ad8ee12 apps/tagma/server/src/landing/contract/service/servedGit.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Settled apps/tagma/server/src/landing/merge/publication.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:ec7b72070cf293c1:ad12cb9e1309 apps/tagma/server/src/native-harness/transcript/restedWork.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:54b4e6d2b9514b74: apps/tagma/server/src/native-harness/voice/calls.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:473695b7f57b95cc: apps/tagma/server/src/platform/contract/service/watch.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Node apps/tagma/server/src/platform/contract/wire/shape.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Durability apps/tagma/server/src/platform/durable/files.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:TreeRescan apps/tagma/server/src/platform/watch/tree.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:PaceLevel apps/tagma/server/src/power/contract/wire/power.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:e79a1a26233fd277: apps/tagma/server/src/providers/contract/service/cli.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:98003f8149f9f773: apps/tagma/server/src/providers/contract/service/registry.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:BorrowingTokens apps/tagma/server/src/providers/credentials/borrowed.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:7496feedf6c53318: apps/tagma/server/src/release-channel/child.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:SettingLandRefusal apps/tagma/server/src/settings/contract/service/values.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:d14bfa2a16918fd0: apps/tagma/server/src/speech/contract/service/models.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Born apps/tagma/server/src/threads/contract/service/engine.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:EvidenceStop apps/tagma/server/src/threads/contract/service/evidence.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated literals:0ce743aa92f1fd0c: apps/tagma/server/src/threads/contract/wire/endings.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:500e6989679cb751: apps/tagma/server/src/threads/list/store.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:143ff8693d74a8e8: apps/tagma/server/src/translations/contract/service/translations.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/workspace/checkouts/comparison.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/workspace/checkouts/fastStatus.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/worktrees/branches/rename.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/worktrees/contract/service/mergeChecks.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/worktrees/listing/mergeChecks.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/worktrees/retirement/finishing.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc apps/tagma/server/src/worktrees/retirement/guards.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Node checks/lint/catalogTags.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:56362fadaf83556b:aee7d4b13f7c packages/adapter-cursor/src/runner/channel.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:56362fadaf83556b:aee7d4b13f7c packages/adapter-opencode/src/runner/channel.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ThreadPartGrowth packages/agent/src/thread/run/ThreadStreamParts.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:EndStatus packages/agent/src/thread/run/lifecycle/closing.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:KeyedAnswer packages/agent/src/thread/run/scheduler/answers.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Adoption packages/agent/src/thread/transport/native/adoptions.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Feed packages/chat-ui/src/TranscriptVirtualizer.svelte.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:9c336331fec57e9c: packages/chat-ui/src/composer.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ChatQuestionPrompt packages/chat-ui/src/entries.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc packages/git/src/apart.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc packages/git/src/merge.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc packages/git/src/porcelain.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated union:9feea52989b24598:dfadf2f4aefc packages/git/src/trees.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ModelInput packages/llm/src/llm/call.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:MessageInput packages/llm/src/llm/call.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ToolChoiceInput packages/llm/src/llm/call.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:ToolChoiceMode packages/llm/src/llm/call.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:OpenAICompatibleChatModelInput packages/llm/src/llm/protocols/openai-compatible-chat.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:HttpOptionsInput packages/llm/src/llm/route/definition.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:NeedsWire packages/llm/src/oauth/vendor.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:Database packages/performance/src/SegmentRing.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:d14bfa2a16918fd0: packages/speech-whisper/src/models/ModelStore.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated literals:0bbcb0fdb836c05c: packages/speech/src/wire/capabilities.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated object:473695b7f57b95cc: packages/watch/src/client.ts",
          "owner": "5a3bed29"
        },
        {
          "fingerprint": "repeated-declarations repeated alias:BrowserWindowBounds packages/window-behavior/src/host-electron/types.ts",
          "owner": "5a3bed29"
        }
      ],
      "escaped": [],
      "inspection": "repeated-declarations",
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
If the lowest consumer cannot hold the type without importing upward, the type goes lower still, into the wire of the module it describes. Where no module fits, it goes to platform. A contract's `wire/` may take its own floor below `protocol/`, provided every file of it imports only downward.
