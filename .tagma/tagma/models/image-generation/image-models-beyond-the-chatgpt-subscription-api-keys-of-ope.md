---
id: 01a18892-2688-79d1-b56c-828a7833f7c9
title: "Image models beyond the ChatGPT subscription: API keys of OpenAI, xAI and Muse, then Google"
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a15b94-3ab3-7f8e-9055-3049d8ecdc6e
  - kind: relates
    to: 01a15b94-3ab3-7f8e-9055-304b649d344f
---
Image generation today draws only through the ChatGPT subscription (`openai-oauth`, `gpt-image-2`). A user without that subscription but with an API key of a provider that draws gets no picture tool at all.

What remains possible, each one image-model declaration on the existing contract and one live request:
- `openai` by key on `api.openai.com/v1/images/*`; the key needs Organization Verification;
- `xai`: `grok-imagine-image*`;
- `muse`: `muse-image-1.0` on `api.meta.ai/v1/images/*`;
- Google (Nano Banana), once a Google provider exists.

The first three share the OpenAI Images protocol module, so the cost per provider should be the declaration and its live check; the vendors' contracts are in [[649d344f]]. Later, if wanted: aspect ratio and size, several pictures per call.

Open: whether key users need pictures enough to justify three live-verified declarations, and in which order.