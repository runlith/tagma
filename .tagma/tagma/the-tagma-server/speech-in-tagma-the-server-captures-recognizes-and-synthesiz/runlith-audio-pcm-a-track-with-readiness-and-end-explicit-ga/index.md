---
id: 01a0ff30-3ce0-7879-8c00-c3779d375daf
title: "`@runlith/audio`: PCM, a track with readiness and end, explicit gaps, monotonic time, a streaming resampler, a devices port, and a neutral native-helper protocol"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
`@runlith/audio` is the lower speech kit: what sound is, its time and its gaps, the port through which sound is taken from devices and handed to them, and the neutral native-helper protocol with its client. It holds no platform code. It replaces `audio-capture-core`; `audio-capture-browser`, `audio-capture-node`, and `audio-playback-browser` are deleted with no replacement.

## Sound and time

- **Format** — PCM16 interleaved, sample rate and channel count. The canonical capture form is mono 16 kHz: it is the Whisper and Silero input with no resampling and three times less IPC than 48 kHz. The track's actual format is declared by its readiness, so a rate change is one place.
- **Chunk** — whole samples and the monotonic capture time of its first sample in the consuming process's clock (nanoseconds). An odd byte or an incomplete frame is a producer error, not something the consumer silently cuts.
- **Gap** — a monotonic-time range with no sound: with a known or explicitly unknown boundary, with a cause (overflow, device change, helper failure, recognition failure). Gaps are not filled with zeros.
- **Continuous segment** — sound between two gaps.
- The kit knows no listenings and no scale over them: the consumer keeps origin and scale ([[d3bd40f5|speech protocol]]). Wall clock plays no part in sound time — it can jump.

## Processing

- **Streaming resampler** — polyphase with filter and cross-chunk state: the same input sliced differently yields the same output and the same duration. Resets on a gap. Replaces the OpenAI adapter's block-wise linear resampling.
- **Level** (RMS and peak over a window) — for the verification run and future indicators.

## Devices port

`AudioDevices` is a `Context.Service` filled by the platform implementation; composition picks it by `process.platform` with a lazy import, and on a platform with no implementation it is `none(reason)`.

- **Platform capabilities are data**, not an “which OS” question: microphone, system sound, excluding our own sound from system sound, echo cancellation, output muting, whether permission needs a request. The implementation itself finds out availability at work (helper never started, no GUI session) and answers `absent` with a reason and `unblock`.
- **Permissions**: a known state or `unknown` where the platform cannot read it without a request; then the first capture attempt finds it out.
- **Devices** — an input list with a stable id and label.
- **Capture** — `capture({source: mic | system, device?, echoCancel})` in scope → `Track{format, chunks, end}`. `format` arrives with readiness, before the first chunk; `end` drains the tail, after which `chunks` ends with a reason; closing the scope is interruption with no tail. Refusals are typed: `permission-denied`, `device-missing`, `unsupported`, `helper-mismatch`.
- **Playback** — `play(format)` in scope → readiness or refusal, then `Player`: `write` of whole samples waits for room in a duration-bounded queue (backpressure; refusal means device failure only); `mark(id)`; `clear()` removes everything not yet sounded; each mark resolves as `played` or `cleared`. Closing the scope frees the player, and that is not the same as `clear`.
- **System output muting** — a scoped resource: while at least one holder holds it, output is muted; after the last one the state from before the first returns.

## Helper protocol

A native helper of any OS speaks one protocol, and the TS client above it implements `AudioDevices` for all platforms. The platform implementation provides only the helper launch and the channel (Unix socket on macOS, named pipe on Windows).

**Frame:** 4 length bytes (uint32 little-endian, without the prefix itself), 1 kind byte (`0` — control JSON, `1` — sound), body. Sound body: uint32 resource id, int64 monotonic time of the first sample in helper clock, PCM16. A frame over 1 MiB is a protocol violation.

| Direction | Message | Meaning |
|---|---|---|
| H→S | `hello{token, nowNs}` | first message: one-time token and the helper's monotonic clock; the client translates it once into its own monotonic clock (the error is the local-channel travel time) |
| S→H | `devices` → H→S `devices{list, permissions}` | devices and known permissions, with no request |
| S→H | `capture{id, source, device?, echoCancel}` | open a track |
| H→S | `ready{id, format}` / `refused{id, code, message}` | readiness with the actual format, or refusal |
| H→S | sound frame `{id, atNs, pcm}` | chunk |
| H→S | `gap{id, fromNs, toNs?, cause}` | gap |
| S→H | `stop{id}` / `abort{id}` → H→S `end{id, reason}` | drain the tail or interrupt; `end` is the resource's last message |
| S→H | `play{id, format}` → H→S `ready{id}` / `refused{id, code, message}` | open a player |
| S→H | sound frame `{id, pcm}`, `mark{id, mark}`, `clear{id}` | playback |
| H→S | `played{id, ms}`, `marked{id, mark, outcome: played | cleared}` | queue consumption (credit for `write`) and mark outcomes |
| S→H | `release{id}` → H→S `end{id, reason}` | free a player |
| S→H | `mute{id}` → H→S `ready{id}` / `refused{id, code, message}` | take a muting holder |
| S→H | `unmute{id}` → H→S `end{id, reason: released}` | release the holder |
| S→H | `quit` | exit |

There is no version field. Both sides strictly validate the schema; an unknown message is a `helper-mismatch` refusal with `unblock` “rebuild and reinstall the host app”. A channel EOF on the helper side gives a gap and `end` on all tracks and `cleared` on players; on the client side it exits the helper with muting restored.

## Entries

- `testing` — a fake `AudioDevices` with a track scenario for engine and `speech` module tests.
- `conformance` — a scenario that runs any helper binary through its channel: readiness and refusal, chunks with time, gap, `stop` with tail and `abort`, playback with credit, `clear` and `release`, muting with restore, unknown message, EOF.

## Proof

- Resampler: one input sliced three ways gives identical output and duration; state resets on a gap (unit).
- Helper client against a fake helper on a pair of channels (integration): `hello` and clock translation; `write` waits for credit and does not refuse on a long line; `abort` and `release` of one resource do not touch others; EOF gives a gap on all tracks; an unknown message is `helper-mismatch`; a foreign token is rejected.
