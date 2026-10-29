---
id: 01a11d92-f14b-75af-b91b-2da051bf75cd
title: "Gemini CLI 0.37.1: no turn measured — Google login refused, SessionStart with transcript_path arrives with no login — probe of 2026-10-08"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Attempted live T1–T5 probes in PTY: launch, trust dialog, Google login with and without GOOGLE_CLOUD_* variables",
      "ref": "Gemini CLI 0.37.1 (Homebrew); 2026-10-08; scratch 01a11d5b…/probe (gemini.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Gemini CLI 0.37.1 (Homebrew), 2026-10-08, one host (macOS). **No turn measured: the CLI does not authenticate**, so there is no model reply at all, and therefore none of T1, T2, T3, or T4. Measurements [[a621fbb3]], T1–T5.

## What could be established

- Login via Google with inherited `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`: "Failed to sign in. Message: Permission 'cloudaicompanion.licenses.selfAssign' denied on resource //cloudresourcemanager.googleapis.com/projects/…". The same calls without those two variables: "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products". No Gemini API key in the environment; Vertex AI untried.
- Project hooks (`.gemini/settings.json`) fire even without login, but only after the folder-trust dialog ("Do you trust the files in this folder?"; project hooks do not load without trust) and the "project-level hooks have been detected" warning. The `SessionStart` event arrived twice (per launch) with payload: `session_id`, `transcript_path` (`~/.gemini/tmp/<directory name>/chats/session-<time>-….json`), `cwd`, `hook_event_name`, `timestamp` (ISO-8601 UTC, milliseconds), `source: "startup"`. No file exists at that path: the `chats` directory is empty.
- The Gemini transcript format and turn-end mark were unobserved (no file).

## Not established

Everything else: `Stop` (`AfterAgent`) on interrupt, mid-turn words and hook-window behavior, tool-call limit, transcript format and timestamps. The Gemini profile stays without measurements (`turnOf`/`answerKey` and the `ends` set are unconfirmed). The probe must be repeated with a working login (API key or Vertex AI) on this or a newer CLI version.
