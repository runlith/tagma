---
id: 01a101c2-edb6-7825-b139-46367efb2db4
title: "Thread draft images: drop, paste from anywhere in the thread, and shrinking what the wire rejects"
ord: 35
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: file
    ref: packages/chat-ui/src/Composer.svelte
  - kind: file
    ref: packages/chat-ui/src/draftImages.ts
  - kind: file
    ref: packages/chat-ui/src/DraftImageStrip.svelte
---
An image in a thread draft can be placed with any natural gesture: drag, paste from the buffer with focus anywhere in the thread, pick up from an iPhone via Universal Clipboard. An image the wire does not take but the browser can show is brought up to the wire by the composer itself, without refusal.

## What the user gets

- **Drop.** Files dragged over a thread (feed and composer together) highlight it whole with the attach button's words. Dropped files travel the same path as button-chosen ones. A drag without files — a row, a tab, a panel — the thread does not intercept.
- **Missed drop.** A file dropped where nobody accepted it is absorbed by the Tagma app. Otherwise the browser would have opened it instead of the page.
- **Paste.** ⌘V or Ctrl+V with an image in the buffer puts it into the draft when the target is the composer field, something inside the thread, or unfocused focus after the last click in this thread. A target that is another input field is left alone by the thread. With several threads on screen exactly one takes the image.
- **Shrink instead of refuse.** An image larger than `THREAD_ATTACHMENT_SOURCE_MAX_BYTES` or of a type outside `THREAD_ATTACHMENT_MEDIA_TYPES` that the browser decodes is redrawn into canvas.
  - Size is bounded by 4096² pixels — the canvas area every browser holds, including iOS Safari. The model still gets no more than 2000 px: `normalizeModelImage` does that on the server.
  - Graphics (png, gif, webp, svg, and other non-photo) are encoded as PNG when it estimatedly fits. Otherwise JPEG on white, first lowering quality, then size.
  - The main case is an iPhone photo. Chrome hands it as PNG transcoded from JPEG or HEIC and often larger than 20 MB. Safari may hand HEIC.
- **Refusal.** An image the browser does not decode (HEIC in Chrome) gets the existing refusal: for an allowed type `too-large`, for the rest `unreadable`. The refusal set does not change, and the product words stay.
- **Button.** The attach button accepts any `image/*`, because whatever the browser decodes reaches the wire the same way.
- **In a row.** `stageDraftImages` answers only the added images, and the draft appends them to whatever it holds by the time preparation ends. So two pastes in a row do not overwrite each other while the first is still transcoding.
- **Names.** A repeated name in the draft gets a suffix: Chrome names every paste `image.png`.
- **View.** Clicking a draft preview opens the image in the viewer.

## Mechanics

Everything except missed-drop protection lives in the kit, and every chat on `ChatSurface` gets it with no product change.

- `packages/chat-ui/src/draftImages.ts` — the "as is / transcode / refuse" decision, the transcoding itself, and distinct names.
- `packages/chat-ui/src/imageIntake.svelte.ts` — the `ImageIntake` class, an attachment on the surface root.
  - **Drag state.** Showing starts `dragenter`/`dragover` with the `Files` type on the root. While the highlight is visible only it takes `dragleave` and `drop`, so moves between children do not flicker.
  - **Out-of-field paste.** A `window` listener filters out events already handled by the composer (`defaultPrevented`), input-field targets, and targets outside the root. When the target is `body`, the last `pointerdown` inside the root is needed.
  - **Parsing images from the buffer** is shared between composer paste and outside paste.
- `ChatSurface.svelte` mounts the intake and draws the highlight. `Composer.svelte` parses paste with the shared parser. `DraftImageStrip.svelte` holds its own `ImageViewer`.
- `apps/tagma/app/src/routes/+layout.svelte` absorbs `dragover`/`drop` with `Files` when nobody accepted them (`defaultPrevented` false). Dropping a path into the terminal stays with the terminal panel.
- Server and wire do not change.

## Out of scope

- HEIC in Chrome (decoded by neither Chromium nor prebuilt sharp).
- Draft images after reload.
- Placeholder while transcoding.
- Pasting images into harness threads (terminal).

## Acceptance

- Dropping an image on a thread puts it into the draft. A drag without files is neither intercepted nor highlighted.
- Dropping a file past the thread leaves the tab on Tagma.
- ⌘V of an image after clicking the feed puts it into exactly one thread's draft. Pasting text into the field works as before.
- An image over 20 MB that the browser decodes lands in the draft at no more than 20 MB and 4096² pixels. HEIC in Safari becomes JPEG.
- Typecheck and `@runlith/chat-ui`, Tagma app tests pass.
