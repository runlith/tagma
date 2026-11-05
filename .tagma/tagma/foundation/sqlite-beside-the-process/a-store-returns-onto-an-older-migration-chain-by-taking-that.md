---
id: 01a1ad3a-f90b-78a8-ac16-1c3f7abbf6f4
title: A store returns onto an older migration chain by taking that chain's exact schema and ledger, keeping every row the older shape can hold
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/chainReturn.ts
---
An older build judges a store by its ledger and opens the schema its own migrations would have built, so a store goes back by becoming exactly that: the target chain is applied to an in-memory reference, and the store is reshaped until every table, index, trigger and view reads as the reference's text. The ledger is rewritten to the target chain's rows, so going forward again applies the leaving migrations as new. Deleting ledger rows alone was rejected: the older build would meet columns it never declared, NOT NULL columns it does not fill, and a forward run would fail on objects that already stand.

- **Rows stay where the older shape can hold them.** A table drops the columns the reference lacks where SQLite allows, otherwise it is rebuilt from the reference with its shared columns, rowids and sequence; a required column the older shape adds without a default takes its type's zero. Rows a restored uniqueness or foreign key cannot hold are left out and counted per table, and the references to them follow. A restored unique index keeps the newest row of each duplicate as SQLite itself judges it — the table is copied under that same index, newest first — so NULL keys, collations, expressions and partial indexes hold exactly what the older build would; every rebuilt table is checked against its restored foreign keys.
- **Only what the leaving migrations touched is rebuilt** when every excess ledger row names a migration the leaving build carries; an unknown excess reshapes every table and keeps a table the reference lacks, since it may be no migration's. A table the reference lacks still goes when the leaving chain creates it again going forward, so the forward run never meets it standing.
- **A recreated full-text index comes back holding its rows.** One that keeps its own content is renamed aside and copied back; an external-content one is rebuilt from its table; a contentless one keeps no text to copy, so the caller hands the kit its owner's fill, and one without a fill, or whose fill fails, comes back empty and is named in the answer.
- **`back.sql` runs first**, newest migration first, inside the same transaction: the generic reshape matches columns by name and cannot undo a rename or a rewritten value, so a migration that renames or rewrites what the build before reads carries the statements that return it.
- **What a leaving migration dropped comes back from the copy it kept.** The caller names each leaving migration's kept copy; they are attached before the transaction, since SQLite refuses ATTACH inside one, and restored newest first once the tables stand in the older shape — before indexes and foreign keys judge them, so a restored row the older shape cannot hold is left out like any other. A table the leaving store lacked takes the kept rows; a column it lacked is filled by primary key on the rows still standing, so a row deleted after the drop stays deleted, and an older copy fills only the columns a newer one did not.
- **A store that already fits is left untouched**, and the reference is built only when it does not.
