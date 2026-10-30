---
id: 01a16438-66e6-78c4-8579-22c71ac39bea
title: "Cursor SDK 1.0.35: catalog and identity over public HTTP; wrong-key probe under Bun 1.4.3"
ord: 14
tags: ["research"]
fields:
  {
    "source": {
      "name": "@cursor/sdk 1.0.35 local under Bun 1.4.3",
      "ref": "Bundled code and types of the npm package; live probe of 2026-10-22 with a wrong key; the operator account's valid key never obtained, models never launched"
    }
  }
---
In the 1.0.35 package `dist/bundled/index.js`, `Cursor.me → IZ8 → PU6 → O5.getMe` calls the public `GET https://api.cursor.com/v1/me`; `Cursor.models.list → TZ8 → kU6 → O5.listModels` calls `/v1/models` and returns `response.items` without transforming elements. The SDK passes the Bearer API key; the Cloud Agents API also documents Basic with the key as username and an empty password. So the catalog and identity are available to a plain HTTP client without loading the SDK; equality of answers with a valid key is unverified. Official docs: https://cursor.com/docs/cloud-agent/api/endpoints and https://cursor.com/docs/api.

Live probe under Bun 1.4.3 with a deliberately wrong key: `Cursor.me`, `Cursor.models.list`, and `Agent.create` were rejected with `AuthenticationError: Invalid User API Key`, `code: error`; execution never reached `send`. Detected `~/.cursor` files did not change (mtime/size, walk to depth 3); `cli-config.json` hash and mtime are unchanged. The public `SDKAgent`, `Run`, `SendOptions` have no aside/fork/compact operation and no window-full indicator; bare summary events alone do not give manual compaction. No valid key was obtained and no models were launched: events, usage/price, steer/cancel, resume after exit and SIGKILL, model switches, and `tools: []` stayed without live checking. Script and saved probe: `~/.tagma-dev/scratch/01a163f8-4050-7461-b07a-83db9efce1e1/probe.ts` and `bad-1792678714121.jsonl`; types — `node_modules/@cursor/sdk/dist/esm/{agent,run,usage-types}.d.ts` and `agent/options.d.ts` in the same folder.
