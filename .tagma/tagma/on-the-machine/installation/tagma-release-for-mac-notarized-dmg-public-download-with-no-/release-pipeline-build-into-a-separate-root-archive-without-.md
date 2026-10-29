---
id: 01a1320b-f5f9-7c23-b4d1-4a10c45086a1
title: "Release pipeline: build into a separate root, archive without maps and xattrs, reproducibility, release number"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13305-78fd-7c5d-bc54-dbe0fbf071a5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
  - kind: waits-on
    to: 01a1320b-f60e-77ae-8fb0-4e1e6004373e
---
Spec sections "Modules" (pipeline), "Public build" (no sources), "Reproducible release build", "Signature before Developer ID" (identity, release number). To do: the release is built by the release composition into a separate root, never touches the build machine's `current`, packed as an archive (`COPYFILE_DISABLE=1`, no xattrs); no sourcemaps anywhere (Bun.build, Vite, desktop esbuild); composition checks by developer mark, `*.map`/`sourceMappingURL=data:`/`._*`/quarantine/build-machine home directory; Bun.version and bun sha256 against `packageManager`; Whisper required; path remap in native builds; refusal on a created signing identity; release number into the bundle (`define` instead of `PROGRAM_RELEASE`) and `Info.plist`. The desktop shell build for the release runs with `TAGMA_HOST_IDENTITY=release` (bundle id `com.runlith.tagma`, name `Tagma`); by default the builder builds `Tagma Dev` (task 7fd7e734). No publishing.

Done: the release builds locally, checks pass; a release with a planted mark, developer entry, `*.map` or quarantine xattr refuses (pipeline test). Archive and `install.json` — per the spec's "Channel contract": asset API address in the feed, listing with no absolute paths, `..`, hard links or `._*`, no `executions/bun`, `irreversible` in `install.json` with this release's and earlier releases' changes.

Channel acceptance on a real release (moved from [[e7c84a2a]], because only the pipeline gives a real archive): two local releases N and N+1 with this pipeline, test `file:` feed; N installed by the loader under separate HOMEs and root, N→N+1 update from the window (`succession` of the server, `app.relaunch` of the window into `Tagma.app` N+1, `~/Applications/Tagma.app` replacement through `.Tagma.app.next`), rollback to N and repeated update. The second-macOS-user trial (`packages/release-loader/probe/application-path.sh`: Spotlight, Dock, login entry, App Management, microphone, Accessibility) stays the operator's check.
