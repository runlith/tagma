---
id: 01a0cf32-097a-771e-aeed-af4ffb5c1b45
title: Running terminals survive a replacement of the execution host
ord: 11
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
A server restart already keeps terminals: the host is a separate process and is adopted when its bundle and policy are unchanged ([[447793c9]]). What still ends every running process — a `pnpm run dev`, a harness CLI mid-conversation — is a replacement of the host itself: a changed host bundle, or the operator's forced word ([[123af0dc]]). On 2026-09-23 a `restart --force` ended three executions, a Claude Code thread among them, over a host nothing had changed in.

The wish: work running under a host survives that host being replaced. Not urgent; kept so the design is not lost.

**Options read so far (not measured):**
- **A small holder process per pty** that owns the master side and is the child's parent, so it reaps it and keeps the native exit. The host talks to holders over a unix socket; replacing the host is disconnecting and reconnecting, and the children notice nothing. This is the containerd-shim / conmon / tmux shape. Cost: a new wire between host and holder, one small process per terminal (the `execution_pty` crate already exists to build it from), and the holder itself still cannot be replaced live — it has to change rarely. The new host rebuilds its screen model by replaying the record, so a replacement must stop removing the records tree at boot ([[e2910415]]).
- **Passing the pty master descriptors** from the old host to the new one (SCM_RIGHTS). Fewer processes, but the new host is not the child's parent: on macOS it presumably cannot read the exit status of a process it did not spawn, and the transfer is a fragile moment of its own.

**A cheap part, separable:** `restart --force` could restart the server alone and leave host replacement to its own explicit act, so forcing a restart never ends running work by itself.

**For harness threads specifically**, a CLI that can resume its own session (Claude Code runs with `--session-id` and offers `--resume`) could be relaunched into the same conversation after its process ended, whatever ended it. Which of the six CLIs support this is unread.

**What would inform the choice:** how often host bundles change in practice, how much a holder process costs per terminal on this machine, and whether the exit status really is lost on the descriptor-passing road.
