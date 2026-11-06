---
id: 01a1b237-92f8-7f8f-b10e-72081320848c
title: "The shared Frame is the one iframe: a page needs no protocol, a view's teardown waits in a parking lot, and media only delegates the devices"
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a148a7-a0b7-7e53-9a1e-a1fdde72d807
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/frame
---
`Frame` is the one iframe of the window: a thread page or motion, an MCP App window, and a site a plugin's view embeds with `<Frame>` all draw it. A frame with no `protocol` only shows its page; one with a protocol connects a bridge to the framed document.

By default a frame is someone else's site. Its sandbox is `allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups`, which nested frames and windows the site opens inherit, and its `allow` delegates fullscreen, autoplay, encrypted-media and picture-in-picture. Dropping `allow-same-origin` would leave the site opaque and break the widgets it embeds that have origins of their own. An MCP App proxy and an artifact page pass their own tighter flags instead.

`media` adds `camera` and `microphone` to `allow`, and nothing more: it lets the framed document ask, and the desktop decides per origin whether it gets the device (explanation de72d807). A plugin declares it for the view, so the card says so before the plugin is added.

`ui/resource-teardown` is a request with a wait. When the protocol asks to close with a wait, the frame moves its iframe at the start of the outro transition (`|global`, firing when any parent block pauses) with `moveBefore` into a hidden lot outside the component tree, waits for the view's answer at most a second, and only then removes the bridge and the iframe. Moving it any other way would reload the iframe. Where `moveBefore` is missing (Safari) the outro is held by the paused block itself until the answer, at most a second: an old thread may show through for that time.
