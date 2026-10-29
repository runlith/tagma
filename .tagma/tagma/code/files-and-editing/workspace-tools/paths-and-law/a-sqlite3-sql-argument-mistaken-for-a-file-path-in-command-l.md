---
id: 01a1521e-0c15-76d4-893d-e009a6526e2e
title: A sqlite3 SQL argument mistaken for a file path in command law delivery
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The command successfully showed both partial-index plans, but the tool added an erroneous FileSystem.stat footer for /opt/workspaces/runlith/create table thread_entry(...) and reported the places' law undelivered.",
    "command": "bash(command=\"git status --short -- apps/tagma/server/drizzle/20261019025551_open_questions apps/tagma/server/src/threads/store/kernel.ts; sqlite3 :memory: \\\"create table thread_entry(thread_id text, type text, entry text); create table native_thread(id text primary key, pending_interaction text); insert into thread_entry values('child','question','{\\\\\\\"status\\\\\\\":\\\\\\\"open\\\\\\\"}'),('old','question','{\\\\\\\"status\\\\\\\":\\\\\\\"cleared\\\\\\\"}'); insert into native_thread values('child','{\\\\\\\"status\\\\\\\":\\\\\\\"open\\\\\\\"}'),('idle',null);\\\" \\\".read /opt/workspaces/runlith/apps/tagma/server/drizzle/20261019025551_open_questions/migration.sql\\\" \\\"explain query plan select thread_id as id from thread_entry where type='question' and json_extract(entry,'$.status')='open' union select id from native_thread where json_extract(pending_interaction,'$.status')='open';\\\"\", waitMs=90000)",
    "expected": "The command builds the plan in SQLite :memory:, law delivered on the real source paths and migration.sql; an SQL line not counted as a path."
  }
---
Filed from project `runlith`.

The erroneous path consists of the full sqlite3 SQL argument after :memory:, including CREATE TABLE and INSERT. The failure is in recognizing files when reading the command's output/arguments, not in sqlite3 or the checked indexes. The command completed successfully; no new on-disk state created.
