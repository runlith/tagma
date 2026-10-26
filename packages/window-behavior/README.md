# @runlith/window-behavior

Headless window-behavior capability for Electron-first Runlith products.

The package owns:

- shared contracts for window behavior state and commands;
- runtime-core normalization and presentation semantics;
- Electron host integration;
- optional macOS native support for no-focus-steal via a Node addon;
- runnable Electron examples.

The package does **not** ship UI controls. Buttons, sliders, headers, and app
layouts belong in examples or in product code.

Current status:

- the package is repo-private inside Runlith today;
- the integration guidance below is the intended shape for Runlith apps and
  for any future vendored/extracted use;
- packaging for public third-party distribution is not finalized yet.

## What the package exposes

- `contract`: canonical state model and command model
- `runtime-core`: normalization and invariant logic
- `host-electron`: Electron runtime owners and host adapter
- `bindings`: headless controller/transport layer
- `native`: macOS no-focus-steal native loader, adapter factory, and runtime
  mode handling

## Native support

Electron alone does not provide full parity for macOS no-focus-steal behavior.
For that reason the package can optionally load a package-local native addon
that calls the private `_setPreventsActivation:` selector on `NSWindow`.

Current native scope:

- platform: macOS only
- capability: no-focus-steal / prevents-activation
- fallback: if native support is unavailable, the host falls back to the pure
  Electron behavior

## Build the native addon

From the repository root:

```bash
bun run --cwd packages/window-behavior native:install
```

This expects:

- macOS
- Xcode Command Line Tools
- Bun

Useful commands:

```bash
bun run --cwd packages/window-behavior native:build
bun run --cwd packages/window-behavior native:install
bun run --cwd packages/window-behavior native:clean
```

The package also exposes a bin entry:

```bash
window-behavior-native-install
```

That bin is useful for workspace apps today and should remain the app-owned
entry point if this capability is later vendored or extracted into another
repository.

## Integrating into an Electron app

### 1. Create a transparency-capable window up front

```ts
import {
  createElectronWindowBehaviorBrowserWindowOptions,
} from '@runlith/window-behavior/host-electron';

const window = new BrowserWindow({
  ...createElectronWindowBehaviorBrowserWindowOptions(),
  width: 900,
  height: 600,
});
```

### 2. Resolve native support once in the main process

```ts
import {
  resolveNoFocusStealSupport,
} from '@runlith/window-behavior/native';

const nativeSupport = resolveNoFocusStealSupport({
  mode: 'auto',
});
```

Runtime modes:

- `auto`: use native support when available, otherwise fall back silently with
  diagnostics
- `required`: throw if native support cannot be loaded
- `off`: skip native support entirely

### 3. Pass the resolved adapter into the host

```ts
import { ElectronWindowBehaviorHost } from '@runlith/window-behavior/host-electron';
import { DEFAULT_WINDOW_BEHAVIOR_STATE } from '@runlith/window-behavior/contract';

const host = new ElectronWindowBehaviorHost(window, {
  initialState: {
    ...DEFAULT_WINDOW_BEHAVIOR_STATE,
    transparent: true,
    alwaysOnTop: true,
  },
  noFocusStealNativeAdapter: nativeSupport.adapter,
});

host.reveal();
```

### 4. Expose the host through your app transport

The package does not dictate one backend or IPC topology. Products should keep
their own transport/process ownership and expose the host through their own
main/renderer boundary.

The simplest pattern is:

```ts
import { createTransportFromElectronHost } from '@runlith/window-behavior/host-electron';

const transport = createTransportFromElectronHost(host);
```

Then bind that to your app's IPC, RPC, command bus, or other product-owned
transport.

## No-focus-steal aware revealing

If a product wants the capability to preserve no-focus-steal semantics during
window show/restore, it should call `host.reveal()` instead of open-coding
`window.show()` or unconditional `window.focus()`.

`host.reveal()` keeps the decision in one place:

- standard focus policy: show and focus normally;
- no-focus-steal policy: prefer `showInactive()` when available and avoid
  programmatic focus stealing.

That keeps the reveal path aligned with the same behavior model as the runtime
itself.

## App-owned native setup

Runlith apps should own the moment when native setup is invoked instead of
hiding it inside package installation side effects.

Example app-level script:

```json
{
  "scripts": {
    "window-behavior:native": "window-behavior-native-install"
  }
}
```

That keeps native build policy at the app boundary.

If this capability is later extracted or vendored into another repository, keep
the same rule: the application should decide when native setup runs.

## Examples

Run the included examples from the repository root:

```bash
bun run --cwd packages/window-behavior example:minimal
bun run --cwd packages/window-behavior example:overlay
```

Both examples resolve native support in `auto` mode and log whether native
no-focus-steal support was enabled or whether the Electron fallback path is
being used.

## E2E vs platform smoke

Playwright E2E is useful here for:

- command to state flow;
- renderer updates;
- main-process assertions for BrowserWindow effects such as opacity,
  always-on-top, and content protection;
- host-mode assertions for no-focus-steal fallback versus native support.

Playwright does **not** fully prove OS-level behavior such as:

- real click-through into another application beneath the window;
- real focus preservation relative to other desktop applications;
- real capture-protection behavior in external screen-recording pipelines.

Those behaviors still need platform smoke validation on real desktop runners,
especially on macOS when the native no-focus-steal addon is part of the path.

Recommended platform smoke checklist:

- verify click-through against a second app or browser window behind the
  overlay;
- verify no-focus-steal by keeping another app focused while toggling the mode;
- verify temporary interactive focus still allows text entry in the overlay;
- verify capture protection with a real recording or screenshot workflow;
- verify the native addon path on macOS after `native:install`.
