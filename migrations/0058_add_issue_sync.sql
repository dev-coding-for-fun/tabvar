-- Migration number: 0058 	 2026-06-09T18:00:00.000Z
-- Adds server-managed updated_at sync clock to issue, a 'Deleted' soft-delete
-- status (excluded from stats), and relaxes external_issue_ref so any client can
-- map an offline-created issue by external_id alone.

-- 1. Server-managed sync clock. ADD COLUMN cannot use a CURRENT_TIMESTAMP default,
--    so the column is nullable and backfilled, with triggers keeping it current.
ALTER TABLE "issue" ADD COLUMN "updated_at" TEXT;
UPDATE "issue" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_issue_updated_at" ON "issue"("updated_at");

-- Stamp updated_at on insert when the application did not provide one.
DROP TRIGGER IF EXISTS set_issue_updated_at_insert;
CREATE TRIGGER set_issue_updated_at_insert AFTER INSERT ON issue FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE issue SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

-- Bump updated_at on every change unless the writer set it explicitly.
DROP TRIGGER IF EXISTS set_issue_updated_at_update;
CREATE TRIGGER set_issue_updated_at_update AFTER UPDATE ON issue FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE issue SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

-- 2. Recreate the crag stats triggers so 'deleted' issues are excluded from
--    counts (same buckets as archived/closed/completed).
DROP TRIGGER IF EXISTS update_stats_after_issue_insert;
DROP TRIGGER IF EXISTS update_stats_after_issue_update;
DROP TRIGGER IF EXISTS update_stats_after_issue_delete;
CREATE TRIGGER update_stats_after_issue_insert AFTER INSERT ON issue FOR EACH ROW BEGIN UPDATE crag SET stats_active_issue_count = (SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id  JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')), stats_public_issue_count = (SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed', 'deleted')), stats_issue_flagged = ( SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id JOIN sector ON route.sector_id = sector.id WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')  AND issue.is_flagged = 1) WHERE crag.id = (SELECT s.crag_id FROM sector s JOIN route r ON s.id = r.sector_id WHERE r.id = NEW.route_id ); END;
CREATE TRIGGER update_stats_after_issue_update AFTER UPDATE ON issue FOR EACH ROW BEGIN UPDATE crag SET stats_active_issue_count = (SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id  JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')), stats_public_issue_count = (SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed', 'deleted')), stats_issue_flagged = ( SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id JOIN sector ON route.sector_id = sector.id WHERE sector.crag_id = crag.id AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')  AND issue.is_flagged = 1) WHERE crag.id IN ( SELECT s.crag_id FROM sector s JOIN route r ON s.id = r.sector_id  WHERE r.id = NEW.route_id OR r.id = OLD.route_id ); END;
CREATE TRIGGER update_stats_after_issue_delete AFTER DELETE ON issue FOR EACH ROW BEGIN UPDATE crag SET stats_active_issue_count = (SELECT COUNT(*) FROM issue JOIN route ON issue.route_id = route.id  JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id  AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')), stats_public_issue_count = (  SELECT COUNT(*)   FROM issue JOIN route ON issue.route_id = route.id  JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id  AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed', 'deleted')), stats_issue_flagged = (  SELECT COUNT(*)   FROM issue JOIN route ON issue.route_id = route.id  JOIN sector ON route.sector_id = sector.id  WHERE sector.crag_id = crag.id  AND lower(issue.status) NOT IN ('archived', 'closed', 'completed', 'deleted')  AND issue.is_flagged = 1) WHERE crag.id = (SELECT s.crag_id FROM sector s JOIN route r ON s.id = r.sector_id WHERE r.id = OLD.route_id); END;

-- 3. Relax external_issue_ref.external_route_id (was NOT NULL) so client-synced
--    issues can map by external_id alone. Rebuild table to preserve data + the
--    UNIQUE(external_id, source) idempotency constraint.
CREATE TABLE "external_issue_ref_new" (
    "local_id" INTEGER,
    "external_id" TEXT NOT NULL,
    "external_route_id" TEXT,
    "source" TEXT NOT NULL,
    "sync_data" BOOLEAN DEFAULT TRUE,
    FOREIGN KEY("local_id") REFERENCES issue("id") ON DELETE SET NULL,
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);
INSERT INTO "external_issue_ref_new" ("local_id", "external_id", "external_route_id", "source", "sync_data")
    SELECT "local_id", "external_id", "external_route_id", "source", "sync_data" FROM "external_issue_ref";
DROP TABLE "external_issue_ref";
ALTER TABLE "external_issue_ref_new" RENAME TO "external_issue_ref";
