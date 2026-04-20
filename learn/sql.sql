-- load the SQLite database file
-- .open .wrangler/state/v3/kv/miniflare-KVNamespaceObject/d99e661104a4a135ee593a9bcb0e7f7ed082f7b10baefc85f3cf00828813dd26.sqlite

-- show the schema of the database
.schema

-- list tables
SELECT name FROM sqlite_master WHERE type='table';
/*
_mf_entries
*/

-- show the contents of the _mf_entries table
SELECT * FROM _mf_entries;