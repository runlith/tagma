---
id: 01a108e9-6003-7ee7-aec9-b4cbb0db1a2b
title: "Cursor ACP: --model and set_config_option model write the global model; extra session/new params never picked it"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e, ACP v1; --model composer-2.5, set_config_option model; promptless probes of 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — model-*.jsonl, model-*-configs-before.json, model-*-configs-after.json, backups, restoration.json"
    }
  }
edges:
  - kind: discovered-from
    to: 01a108ce-ee39-7d2f-9573-86fc0db65596
  - kind: relates
    to: 01a1050f-fe45-7d5b-a4d9-cb5c3632e800
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, ACP v1. The initial model was Auto: `cli-config.json.selectedModel.modelId:"default"`, `acp-config.json.selectedModelVariantId:"default[]"`. Each option was checked without a prompt; both global files were restored from pristine copies afterward. `session/set_model` was not called. Frames and full before/after snapshots: `model-*.jsonl`, `model-*-configs-before.json`, `model-*-configs-after.json`.

## Measured options

- `agent --model composer-2.5 acp` accepts the root flag but changes the global `cli-config.json` before session creation: model, selectedModel, fast:true, and modelSelectionHistory order. `acp-config.json` stays default[], and session/new returns `currentModelId:"default[]"`. This is both a global side effect and an unproven ACP-session model choice.
- `agent acp --model composer-2.5` behaves the same: the global CLI model changes, the ACP currentModelId stays default[].
- `session/set_config_option {sessionId,configId:"model",value:"composer-2.5[fast=true]"}` answers with new `configOptions` showing the picked model but writes both global files: CLI model/selectedModel/history and ACP selectedModelVariantId. The method name does not make the change session-local.
- Passing `model:"composer-2.5"`, `modelId:"composer-2.5[]"`, `configOptions:[{id:"model",value:"composer-2.5[]"}]`, `_meta:{model:"composer-2.5"}` together in `session/new` created the session with currentModelId still default[] and the model in both files unchanged. This probes only these extra fields, not a promise that no undocumented option works.

Even a plain session/new updates `cli-config.json.privacyCache.updatedAt`; that is a separate cache side effect, not a model choice. The timestamp update counted as neither model-choice success nor failure.

## Consequence for the profile, and restore

No way to pick the ACP-session model without writing the user's model was found in the public inputs studied. For this build the profile must stay on the CLI/ACP default model and refuse an explicit model choice rather than call set_model, set_config_option model, or root --model. Which model the server would actually have used on the next prompt after root --model is undetermined: those checks had no live turn, and session/new announced Auto.

Restore meant copying the pristine files back, not an inverse model-choice call that would rewrite history again. Final byte-for-byte check in `restoration.json`: both configs match the backup. SHA-256 of initial and final files: CLI `1113e28fc02c2132abde528090336baa5eed70c268b969a768b71e144e649ce7`, ACP `30dd37be2ebeca92545cfbfabc46d0e312d72f96465c94aca10e7cc39fe9e9a8`.
