---
kind: upgrade-guide
description: "Chat journal schema 2 records model outcome independently of delivery and cannot be reopened by schema 1 code."
---
# Chat journal schema 2

## Change

Early development journals using schema 1 do not record model outcome or previous-answer delivery state. Schema 2 adds these fields without changing admitted source bytes or native DSH Session logs. The worker migrates schema 1 transactionally before accepting new requests. Previously unrecorded model outcomes become `unknown`; previous delivery state becomes `null`. Schema 1 code cannot read the upgraded database. Foreign databases and newer schema versions are refused.

## Migration

1. Stop the owning DSH profile and preserve a consistent backup of its journal and any SQLite WAL/SHM files. Do not copy a live database file alone or open the same journal in two Hosts.
2. Keep `namespace`, `databasePath` and `workspacePath` unchanged, then start the profile with this candidate. The worker upgrades the existing journal before reporting readiness; a live owner is not displaced.
3. Inspect native plugin status for successful startup and retained receipt/mapping counts. Existing pending work is marked interrupted and is not replayed. New replies record model and delivery results independently.
4. If startup refuses the database, retain it and its backup for diagnosis. Do not lower `user_version` or delete the journal. To return to older code, stop the profile and restore its complete pre-upgrade backup; never overwrite the only upgraded copy.
