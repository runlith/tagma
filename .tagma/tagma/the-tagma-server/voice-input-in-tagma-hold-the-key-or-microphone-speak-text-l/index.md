---
id: 01a10b70-624a-788b-ba2a-cbe616b50a26
title: "Voice input in Tagma: hold the key or microphone, speak, text lands in focus — the agent field, terminal, and in desktop any app"
ord: 102
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff30-3ce0-7879-8c00-c376b4ee7196
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/speech
  - kind: dir
    ref: apps/tagma/server/src/speech
---
Voice in Tagma is an input method. You hold the key or press the microphone and speak. The text lands where the cursor stands: in the agent conversation field, in the Tagma terminal, and in desktop in any app. The server captures and recognizes sound ([[b4ee7196|speech in Tagma]]), so the window on the server machine needs no microphone access, and Chrome and desktop in the window work the same. On a paired device the page itself records sound, and the server recognizes it ([[62d4cbd1|device voice]]). UX project: http://localhost:5634/a/8da4bf3e0499.

## What the user gets

- **Gesture.** Hold `⌥ Space` — recording runs, release — the text is inserted. A press under 300 ms turns recording on until the next press: for long thoughts, with no separate setting. `Esc` cancels, and text inserted by that dictation is removed. The key can be changed in settings.
- **Nothing sends itself.** The text lands in the field as typed; it is edited and sent by hand. Releasing with `⇧` held inserts and immediately sends in the agent field. In the terminal Enter is never pressed.
- **Live text.** In the agent field the confirmed text grows right in the draft, and the unsettled hypothesis shows gray after it and does not enter the draft. The field frame is red, with a timer and sound level next to it. If the level stays flat for over 3 s, a "we cannot hear you" hint appears. In the terminal the live text stands in a chip above the input row, and after release only the final phrase prints into the terminal, via bracketed paste.
- **Where the text goes.** Into focus: the agent field or the terminal. If neither holds focus, the text goes to the visible thread's agent field. If there is no such field, the key shows a short hint and writes nothing.
- **Tail reading.** After release the server asks the recognizer to confirm the tail and inserts it. The wait is capped at 2 s: on expiry the confirmed text plus the last hypothesis is inserted. There are no "accuracy versus speed" modes.
- **Why not.** The microphone in the field never hides when recording is unavailable. It shows the reason the speech status already gives: no permission, no key, no model, a server on a machine without the helper. Next to it, the road to fixing.
- **Recording indicator.** While at least one capture is open on the server — dictation, agent listening, or a check — a chip burns in the Tagma top panel: timer, sources, and "Stop". It is state, not a question and not a permission.
- **Global dictation (desktop only).** The same key (changeable) works with any active app. A pill with level and live text appears at the screen bottom, and after release the text is inserted where the cursor stands. Off by default.
- **Settings.** "Speech" gains a "Voice input" block: the dictation recognizer (default — the shared speech recognizer), the window key, global dictation with its key. Languages, microphone, and keys are shared with the rest of speech.

There are no voice commands: what was said is what prints. Turning a phrase into a command is a separate future product.

## Architecture

```
agent field ─┐                                ┌─ speech.recognize (feed, id) ─▶ Listenings.recognize
terminal ────┼─▶ Dictation (window) ──ops/feeds─┤
pill ────────┘        ▲                         └─ finish_recognition {id}     ─▶ read the tail, end the feed
                      │ keys, insertion
             desktop main (desktop-input)
```

### Server, the `speech` module

- **Recognition ends with tail reading.** Now the `speech.recognize` feed ends only on unsubscribe, and unsubscribe cuts the tail. The feed ask gains an `id` selecting the window. The `finish_recognition { id }` operation stops that recognition's capture, as `end_listening` with `finish` stops listening tracks. The recognizer confirms the tail, the feed yields the last `utterance`, track phases `finished`, and ends. Unsubscribe stays `stop`. `Listenings` holds open recognitions by `id`, and `finish` on an unknown `id` refuses `unknown-recognition`. The tail-wait limit belongs to the window; the server waits on the recognizer as it does on listening `finish`.
- **Open captures are visible.** The `speech.captures.subscribe` feed returns the machine's current capture set: every project's listenings and recognitions, each with kind, sources, start, project, and listening id. The same registry that opens and closes captures feeds it, with no polling. "Stop" in the chip calls `end_listening` with `stop` for listening and `finish_recognition` for recognition.
- **The dictation recognizer** is the `speech.dictation.recognizer` setting key. Empty means the shared `recognizerChoice`. Selection follows the same `chosen` as listenings, with no vendor branching.

### Window, `apps/tagma/app`

- **`features/speech/dictation`** holds the `Dictation` service: one dictation at a time per window. It opens the feed with a new `id`, tracks the stable prefix and hypothesis by replica key (like the check's `apply`), calls `finish_recognition` on release, waits for the feed end no longer than 2 s, and returns the result to the target. `Esc` unsubscribes and rolls back the inserted text.
- **A target** is a small contract registered by an input place: take the stable increment, show the hypothesis, take the final, roll back. Two implementations — the agent field and the terminal. Key and microphone find the target by focus, and `Dictation` knows nothing of fields.
- **The agent field.** `@runlith/chat-ui` is a kit; it does not import speech. The composer gets a slot for a button next to send and text insertion at the caret. The hypothesis renders as a `PromptField` mirror segment (its `mirror` already paints segments) and does not enter `draft`. Tagma fills the slot with its own microphone button.
- **The terminal** inserts the final through `Input.paste`; the live-text chip stands above the panel.
- **The recording chip** sits in the top panel, over the `speech.captures` feed.

### Desktop, `apps/tagma/desktop`

- Main wires `@runlith/desktop-input`: an event tap for key hold (`HoldBindingMatcher`) and `⌘V` insertion with clipboard restore. Accessibility is needed, and its permission rests on the `Tagma.app` signature like the microphone. The `desktop-input` native binary lives in `Tagma.app` and is signed with the same identity.
- The pill is a separate transparent window on top of all, a Tagma window page with the same `Dictation`. Main passes it press and release through preload, and it returns the result to main for insertion. Main does not touch sound: it passes keys, shows the window, and inserts text.
- Without Accessibility the global-dictation switch shows the reason and the system-request button. If insertion failed, the text stays in the clipboard, and the pill says "press ⌘V".

## Order

1. Server: `id` and `finish_recognition`, the dictation recognizer key. Window: `Dictation`, the "agent field" and "terminal" targets, button, key, settings block.
2. Indicator: the `speech.captures` feed and the chip.
3. Global dictation in desktop.

Steps 2 and 3 are independent of each other. Each step ships on its own.

## What proves it

- A server itest on fake devices and provider: `finish_recognition` returns the confirmed tail to the feed's end. Unsubscribing does not wait for the tail. `finish` on an unknown id refuses.
- A capture-feed itest: listening and recognition open and end arrive as events.
- A `Dictation` unit test on a fake feed: the stable increment inserts in order. Revisions do not duplicate text. On 2 s expiry the confirmed text plus the hypothesis is inserted. `Esc` returns the draft to its pre-dictation shape.
- Smoke of the installed `Tagma.app` and Chrome: dictation into the agent field and the terminal on Soniox, OpenAI, and Whisper. The chip during agent listening. Global insertion into Notes after granting Accessibility, and the grant survives a rebuild.
- Measurement as a sample on the named machine: from release to insertion on each of the three recognizers.

## Out of scope

Voice commands and turning a phrase into a command. Dictation into any window field other than the agent field and the terminal: a new target adds it if needed. Ducking Mac sound while recording.
