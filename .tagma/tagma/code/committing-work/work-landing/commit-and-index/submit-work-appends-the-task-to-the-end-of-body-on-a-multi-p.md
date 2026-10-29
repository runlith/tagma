---
id: 01a13bfe-c774-7a5a-944c-176163b51bc0
title: submit_work appends the task to the end of body on a multi-paragraph message instead of subject
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "Commit 25bf386260 is created; git show -s --format=%B shows (1f6528e0) at the end of the second body paragraph. The subject's first line has no task reference. A separate message check was needed; no amend was performed.",
    "command": "submit_work({\"subject\":\"refactor(sandbox): adopt Effect closures and scoped copy holds\\n\\nAdd spans for DockerGuests.*, DockerPreparation.*, SandboxStore.*, PreparedTreeStore.*, Sandboxes.*, SandboxFiles.read, GuestWorlds.world, PreparedTrees.*, GuestChannel.call, archive.{take,open,create,directory,append,close}, and sandbox.{buildGuest,copyGuest,settleGuest,snapshotGuest,digestInputs,readGuestFile,releaseGuest,freshExportArchive,dropPartial,guestRevision,buildGuestImage,listening,transfer,sealArchive,unpackArchive,snapshotInto,spawn,endInGuest,stillSession,reconcileEngineDrift}; preserve all 21 existing spans.\",\"paths\":[\"apps/tagma/server/src/sandbox\",\".agents/skills/effect4/SKILL.md\"],\"whole\":true})",
    "expected": "When a message with a body is accepted, the held task's id goes to the subject — the first line, as the submit_work contract promises."
  }
---
