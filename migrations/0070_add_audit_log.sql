-- Migration number: 0070 	 2026-10-16T23:09:55.005Z

-- History of crag, sector, route, and topo changes for manual investigation.
-- User columns have no foreign keys so rows survive account deletion.
CREATE TABLE "audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_uid" TEXT,
    "author_name" TEXT,
    "reviewer_uid" TEXT,
    "reviewer_name" TEXT,
    "decision" TEXT,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" INTEGER,
    "action" TEXT NOT NULL,
    "changes" TEXT NOT NULL,
    "submission_id" TEXT,
    "ref" TEXT
);

CREATE INDEX "audit_log_entity_index" ON "audit_log"("entity", "entity_id");
CREATE INDEX "audit_log_author_uid_index" ON "audit_log"("author_uid");
CREATE INDEX "audit_log_submission_id_index" ON "audit_log"("submission_id");
