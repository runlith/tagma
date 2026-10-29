---
id: 01a10226-cb49-7c05-9d1f-d6e02a572202
title: Thread-history pictures stay under the provider request limit
ord: 1
---
A stream's pictures are held under the provider request limit. The provider rejects the whole request when its pictures exceed the byte or count limit (`requestLimits` of the catalog line; for Anthropic 32 MB and 100 items). So `prepare` holds the history pictures under that limit before sending, not after a refusal.

- **Budget.** Before every step `prunePictures` counts all request pictures: operator pictures in `media` and tool pictures in `file`. Past 3/4 of the limit the oldest are removed until 1/4 remains. First those before the current turn: operator ones up to the last message opening the turn (`latestTurnStart`: a user message with no origin or with an `envelope` origin), tool ones as whole results up to the last assistant answer. Current-turn pictures leave only when the turn alone does not fit in 3/4 of the limit, oldest first too.
- **The decision is written into history.** A removed picture is replaced in the stream record by an `omittedMedia` line with the same fold as a cleared tool output. The next step sees the same history and removes nothing. The 3/4 → 1/4 hysteresis exists so such a prefix rebuild stays rare: each one costs one prompt-cache miss.
- **A provider refusal.** When the provider still rejects the request (`contextOverflow`), a retry removes pre-current-turn pictures and adds a one-off `overflowMediaGuidance` message. The removal is written into history at once. While it was only a projection, every next step got the refusal again on the first try, and the trailing hint broke the shared prefix so the cache read one system part.
- **No refusal, by tokens.** When the request does not fit the window by tokens, pre-current-turn pictures leave the projection only, with no hint. That decision is deterministic, so neighboring steps send the same prefix.

The picture interface is lossless: the transcript holds attachments apart from model history.
