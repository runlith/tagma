---
id: 01a11971-8260-7fa7-be45-51807077dff3
title: "bash: execution host unreachable with WireInvalid on a heredoc command"
ord: 58
tags: ["reflection"]
fields:
  {
    "actual": "\"Whether this command started is not known: the execution host could not be reached: WireInvalid\"; the directory was never created — the command never actually ran",
    "command": "bash: mkdir …/market && cd … && cat > root.md <<'EOF' … (many heredoc blocks in a row, ~25 KB in one command)",
    "expected": "The command runs or refuses in a typed way against its size limit"
  }
---
Filed from project `runlith`.

Retrying the same work through the file tools passed. Looks like a wire failure to the execution host on a large command body, not host unreachability.
