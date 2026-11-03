---
id: 01a1047e-ddf0-7edd-b8da-e66cc3dad364
title: "\"macOS 26: TCC attributes everything inside the bundle to the app itself, a self-signed certificate keeps permissions across rebuilds, SMAppService works without a Developer ID\""
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Probe-app experiments on macOS 26.0.1 (25A362), arm64: tccd logs, SMAppService, AVFoundation, CoreAudio taps",
      "ref": "The operator's machine, 2026-10-04; Swift 6.2, Electron 41.1.0, bun from ~/.tagma/install; Astra review (gpt-6-astra)"
    }
  }
---
Experiments on one machine — macOS 26.0.1 (25A362), arm64 — were run to decide where Tagma keeps native audio capture and how to sign `Tagma.app`. The operator pressed the permission dialogs. What was decided from `tccd` logs shows in `AUTHREQ_PROMPTING`, `AUTHREQ_ATTRIBUTION` lines and `TCCDEvent` events. The probe apps were in Swift (AVFoundation, `SMAppService`); system audio was captured by `runlith-audio-capture` from `packages/audio-capture-darwin`, wrapped in a bundle. The experiment sources are not kept in the repository, so this record cannot be reproduced without rebuilding the probes.

## Whose permission a process uses

- **Everything inside the app is attributed by macOS to the app itself.** Experiment: a stub server — not the main executable but `Contents/MacOS/server` inside the parent bundle — launched by the background agent, asked for the microphone. The TCC record was created on the parent's bundle id. After that, with no new dialogs, two nested helper apps from `Contents/Helpers` with their own bundle ids gained access: the server's direct child and a helper opened through `open`. Neither received a TCC record of its own.
- **Who launched the process matters only for direct children.** The same server was launched by someone else's app, which never received the microphone. Then the server and its direct child got `notDetermined` status: they were attributed to the launching app. A nested helper opened through LaunchServices stayed `authorized` — still attributed to the parent.
- **Tagma's server processes have no responsible app.** The private API `responsibility_get_pid_responsible_for_pid` returned the own pid for the running server, the execution host, and any commands under them. For children of an app launched through `open`, the same API returned the app's pid. What "own pid" means for TCC, this experiment does not establish: Apple distinguishes the responsible process from the responsible code. The parent experiment above shows nested code is still matched to the bundle.
- **Inheritance.** `Bun.spawn` (including `detached`) and `node:child_process` in bun and in Electron 41.1.0 pass the app responsible for the parent down to children. A process spawned after that app has exited never receives it. Closing the Tagma window does not count as quitting: on macOS the app keeps living (`apps/tagma/desktop/src/main.ts`, `window-all-closed`).

## The signature decides whether a permission survives a rebuild

- **Ad-hoc signing** (requirement `cdhash H"…"`): every build with changed code prompted the dialog again. After the rebuild `authorizationStatus` returned `notDetermined`.
- **A self-signed certificate** with EKU codeSigning, untrusted in the Keychain (requirement `identifier "…" and certificate leaf = H"…"`): after a rebuild with different code the status stayed `authorized`, `requestAccess` answered in 0 ms with no dialog, capture flowed. An app copy at another path with the same bundle id and certificate is `authorized` too. The permission is bound to the bundle id and the certificate, not to the path or the code hash. Replacing the certificate breaks that requirement, and permissions must be granted anew.
- Surviving a rebuild is verified for the microphone only. For system audio and for the Developer ID that is an expectation on the same model, but unmeasured.

## System audio

`runlith-audio-capture` in a bundle with `NSAudioCaptureUsageDescription`, opened through `open` from a tree with no responsible app, prompted the `kTCCServiceAudioCapture` dialog on its own bundle's name. After granting, genuine samples arrived in PCM during `afplay` (peak 9718 of 32767). No private `TCC.framework` check was needed: the ordinary capture path requests the permission.

## SMAppService without a Developer ID

- An ad-hoc- and a self-signed app from an arbitrary folder (not `/Applications`) registered `SMAppService.agent`: status `enabled`, the agent with `RunAtLoad` launched at once, `unregister()` removed the service.
- An agent whose program is not the bundle's main executable works too.
- Two apps with one `Label` conflict: the second launched the first's binary. Hence the rule: the Label is unique per product and channel and never changes across updates.
- Not verified: login and logout, the user disabling the background item (`requiresApproval`), the addition notice.

## bun under hardened runtime

Official bun is signed `Developer ID Application: Jarred Sumner (7FRXF46ZSN)`, with hardened runtime. Its entitlements: allow-jit, allow-unsigned-executable-memory, disable-executable-page-protection, disable-library-validation, allow-dyld-environment-variables.

Re-signing with hardened runtime but no entitlements silently switches JIT off. The same loop: 16.9 s versus 0.3 s. One `com.apple.security.cs.allow-jit` suffices to bring JIT back. These are single-run measurements on one machine.

## Gatekeeper

`spctl --assess --type execute` rejects both the ad-hoc- and the self-signed app. A downloaded quarantined app was not tested.

## What is not established

- macOS 14 and 15; installation into `/Applications`; a downloaded quarantined app.
- The Developer ID signature and notarization.
- The app name in the system recording indicator; behavior after permission denial and revocation.
- Capture after the death of the process that launched it.
