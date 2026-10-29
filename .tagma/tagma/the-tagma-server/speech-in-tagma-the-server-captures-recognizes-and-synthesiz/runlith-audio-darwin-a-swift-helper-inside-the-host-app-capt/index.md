---
id: 01a0ff30-3ce0-7879-8c00-c378acba5047
title: "`@runlith/audio-darwin`: a Swift helper inside the host app captures the microphone and system sound and plays synthesis; launch via LaunchServices and Unix socket"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
---
`@runlith/audio-darwin` is the `AudioDevices` port implementation on macOS: a Swift helper app captures the microphone and system sound and plays synthesis, and talks to the server in the helper protocol from [[9d375daf|the audio kit]] over a Unix socket. The package provides the helper (binary and `Info.plist` template), its launch via LaunchServices, and the channel; the TS client and the protocol are shared across all platforms. It replaces `audio-capture-darwin` (a per-capture audiotee CLI with a stdout pipe), which cannot run under LaunchServices: such a helper is not the server's child and does not inherit stdio.

## What moves over from audiotee, what is written anew

- **Moving over** as proven low-level code: the CoreAudio tap and aggregate device sequence (`AudioTapManager`), PID-to-audio-process translation for exclusion, device enumeration and microphone matching by UID.
- **Written anew** are the realtime path, conversion, stop, time, IPC, and process management. Reasons are the audit's defects: allocation, conversion, and blocking stdout in the IO callback; `fatalError` on IOProc failure; on converter failure sound leaves in the device's format disguised as PCM16 16 kHz; the converter can take one input twice; a planar microphone's first channel only is read; stop races the callback without synchronization and loses the tail; ring overflow silently drops sound; time is `Date()` at slicing instead of device time.
- **Not moving over**: preflight permission checks through private `TCC.framework` (for system sound it also fires the request with up to a 60 s wait) and CLI flags on each launch. Microphone permission is read from `AVCaptureDevice.authorizationStatus`; system-sound permission has no public read API without a request, so it stays `unknown` until the first capture attempt.

## Realtime path

- The IO callback only copies frames and `inInputTime.mHostTime` into a preallocated lock-free single-producer single-consumer ring. No allocation, no conversion, no locks, no logs.
- A separate helper thread reads the ring, converts to the track format (all channels, downmix to mono), cuts 20–40 ms chunks (the size is a measurement value; the old helper accumulated 200 ms before sending), and writes to the socket. A chunk's time is the monotonic host time of its first frame.
- The socket sender keeps the same budget as the ring: a slow server produces a `gap`, not a growing send buffer.
- Ring overflow, device change or loss is a `gap` with a range, not a log.
- Converter creation or conversion failure is a track refusal, not sound in another format.
- `stop`: first `AudioDeviceStop`, then the consumer thread drains the ring and the incomplete tail, then `end`. `abort`: stop with no tail.

## Output, echo cancellation, and self-exclusion

- The helper holds one output graph per output device; all players mix into it. While at least one microphone track with `echoCancel` is open, the graph is Voice Processing I/O and its output serves as the echo-cancellation reference; otherwise it is a plain output. Switching graphs is a short output restart with no queue loss. A microphone without `echoCancel` is raw.
- Whether echo cancellation really kills Tagma's sound and what VPIO side effects are (ducking of other sound, microphone format change) is unmeasured: smoke is what confirms the goal.
- Excluding our own sound from the system tap: the helper opens the output graph (silently, if there are no players) before creating the tap, and only then translates its PID into the audio process object — the exclusion list is set once at tap creation. If the process object never appears, that is a `system` track refusal, not a tap without exclusion.

## Output muting

The helper remembers the output device's mute state before the first holder and restores exactly it after the last `unmute`, on `quit`, and on socket EOF.

## Launch and life

- On first request the client starts `open -g -n -a "<host>.app/Contents/Helpers/<helper>.app" --args --socket <path> --token <token>`. The host app path and helper name come from the host composition.
- The socket sits on a short path in a 0700 directory (`$TMPDIR/<data-directory hash>.sock`): the Unix socket path on macOS is limited to 104 bytes; each server has its own path.
- No `hello` in time (no GUI session, helper never started) — availability is `absent` with a reason.
- The server holds the helper in scope while at least one resource is open, plus a short idle wait, then sends `quit`. The helper exits on socket EOF: a dead server leaves no orphans.

## Delivery

- The helper is built from checkout and embedded into the host app's `Contents/Helpers` by its build (`apps/tagma/desktop/scripts/build-host.ts`). Name and bundle id are set by the host (`<host-id>.audio`); the kit names no product. Signing is inside-out with the same stable local identity with hardened runtime and the `com.apple.security.device.audio-input` entitlement; `Info.plist` carries `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription`.
- TCC attributes the helper to the host app ([[c3dad364|TCC research]]).
- System sound needs macOS 14.2 (CoreAudio process tap); below that — a declared absence.

## Proof

- Swift (unit): ring and consumer thread on a synthetic producer lose and duplicate no frames; the tail arrives on `stop`; overflow produces a `gap`; multi-channel planar input is folded in full; muting restores the prior state on EOF.
- The `@runlith/audio` conformance scenario against a built helper with synthetic devices.
- Smoke of an installed `Tagma.app`: microphone and system-sound permissions; real frames from both sources; synthesis started after system capture began does not land in the system track; synthesis started before capture with `echoCancel` is killed by echo cancellation without headphones; the helper exits after server death and restores muting.
