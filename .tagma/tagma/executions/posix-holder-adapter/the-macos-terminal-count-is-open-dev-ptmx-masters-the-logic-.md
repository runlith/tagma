---
id: 01a128dc-fa24-746e-9ba0-2aa19c3c12df
title: The macOS terminal count is open /dev/ptmx masters; the logic treats its own terminal as one fd
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/standing.ts
---
PTY occupancy on macOS is read from open /dev/ptmx descriptors, not from /dev/ttysN nodes: nodes survive closing and name the high-water mark of allocated ones. The count runs over user processes (others' are invisible without root) and excludes the holder's own descriptors.

The holder is excluded because each of its own terminals holds two fds — the holder's master and the logic's copy; capacity subtracts one per live terminal (`liveTerminals`) from the reading, and the count rests on the discipline "the logic holds exactly one fd per live terminal". The logic's copy is never duplicated (dup) without updating that count; otherwise the subtraction undercounts and terminal admission over-refuses.

When the masters cannot be read (probe failure or truncation), the count is a bound: the number of /dev/ttysN nodes. It is no less than the occupied ones, errs toward refusal, and never refuses loading and recounting; terminals become unreadable (StandingUnreadable) only when /dev cannot be read either.
