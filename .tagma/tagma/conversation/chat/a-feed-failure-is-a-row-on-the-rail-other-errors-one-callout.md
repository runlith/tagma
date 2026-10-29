---
id: 01a16bb5-89a4-70bd-9b8e-537daf7f1b16
title: A feed failure is a row on the rail, other errors one Callout card; a command refusal carries its human words into the thread
ord: 65
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146ca-49a1-756b-8020-330d35c0e724
  - kind: relates
    to: 01a16b9e-89b8-70ba-8438-34fca7f74bfb
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/TurnFailure.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadPort.ts
  - kind: file
    ref: packages/chat-ui/src/Callout.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ClampedText.svelte
  - kind: file
    ref: packages/chat-ui/src/FailureRow.svelte
  - kind: file
    ref: packages/chat-ui/src/notice.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/native/runEndingLine.ts
    symbol: failureTitle
  - kind: symbol
    ref: packages/chat-ui/src/clipFade.ts
    symbol: clampFade
  - kind: symbol
    ref: packages/llm/src/llm/schema/errors.ts
    symbol: providerSaid
---
A failure that became a feed entry — a fallen turn, an unreadable entry, an unwritten recap — draws `FailureRow`: a row on the feed rail with a red square, like any step and like a refused tool call. It has no frame, background or band: feed steps look exactly so, and a left band in the app means only "you are here".

A failure row speaks to the person, not the debugger. The title is what happened, by failure family, cause kind and provider name ("OpenCode Go API key has expired"). The app's `failureTitle` builds it, the same function that writes the run-end band at the input field and the thread row in the list, so one failure is never named differently anywhere. The text is the provider's own words (`reason.said`): the answer classifier takes them from the error body, and a code like `api_key_expired` sets the `expired` kind. The raw exception message stands as text only for a familyless failure. The button is the act that fixes the cause ("Replace key" or "Sign in again" lead to providers in settings). Continuing, rolling back and switching models belong to the band at the input field: the row has no second button for the same act. Technical facts (stage, HTTP, request id, run, entry) and the raw message never stand in the feed. "Copy report" carries them, and in detailed mode "Details", which opens under the buttons and replaces nothing. There is no "Failed after …" row under a failure: the feed never shows a run end that has a failure row.

A fallen tool call is the same rail step: red square and red row, no frame or fill. The failure text stands under the row as plain text. When the producer gave the fallen call facts (`exit 1`, `ended killed`), they name the outcome, and the kit adds neither the word "Failed" nor failure text: for `bash` that text ("Command exited with status 1.") would repeat the same fact in other words. A call with no facts shows both "Failed" and the text.

Long text cuts on height with one mechanism — `clampFade` with a bottom fade. Failure text (`ClampedText`: three rows, "Show all", Copy), the step body (`Clamp` in the well, 173ab5ec), `FailureRow` and `Callout` all use it. No summary cut by character count with an ellipsis exists: only the interface cuts, on actual height.

Anything not a feed entry — a refusal over the input field, "thread unreadable", "file unread" in a tab, notice cards — draws `Callout`: a state square and title, explanation, button row, corner cross. It is one card: the place where it stands sets the surface (background, shadow, width). A red square is refusal or failure, gray everything else, including successful outcomes: color stays with the signal.

A chat-command refusal brings the refusal's human words into the thread, not the agent text. `ThreadPort` puts the `words.text` title and the explanation, details (`reason`, exits), code and act — its own or an `Offer` proposal when the code matches — into `ChatCommandRefused`. Before, the feed got only `reason`, and in the demo the same refusal sounded "… needs the app" with a Get Tagma button in the notice card, but an agent phrase with no button in the thread.
