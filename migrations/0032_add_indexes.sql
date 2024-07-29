-- Migration number: 0032 	 2024-07-02T17:13:32.654Z
CREATE INDEX IF NOT EXISTS "crags_public_issue_count_and_name" ON "crag" (stats_public_issue_count, name);
CREATE INDEX IF NOT EXISTS "crags_active_issue_count_and_name" ON "crag" (stats_active_issue_count, name);