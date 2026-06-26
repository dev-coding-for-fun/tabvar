-- Migration number: 0059 	 2026-06-22T17:30:00.000Z
-- Adds server-managed updated_at clocks for topo objects and bumps direct
-- parents when attachments are added, changed, or removed.

ALTER TABLE "crag" ADD COLUMN "updated_at" TEXT;
ALTER TABLE "sector" ADD COLUMN "updated_at" TEXT;
ALTER TABLE "route" ADD COLUMN "updated_at" TEXT;

UPDATE "crag" SET "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;
UPDATE "sector" SET "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;
UPDATE "route" SET "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_crag_updated_at" ON "crag"("updated_at");
CREATE INDEX IF NOT EXISTS "idx_sector_updated_at" ON "sector"("updated_at");
CREATE INDEX IF NOT EXISTS "idx_route_updated_at" ON "route"("updated_at");

DROP TRIGGER IF EXISTS set_crag_updated_at_insert;
CREATE TRIGGER set_crag_updated_at_insert AFTER INSERT ON crag FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS set_crag_updated_at_update;
CREATE TRIGGER set_crag_updated_at_update AFTER UPDATE ON crag FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS set_sector_updated_at_insert;
CREATE TRIGGER set_sector_updated_at_insert AFTER INSERT ON sector FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS set_sector_updated_at_update;
CREATE TRIGGER set_sector_updated_at_update AFTER UPDATE ON sector FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS set_route_updated_at_insert;
CREATE TRIGGER set_route_updated_at_insert AFTER INSERT ON route FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS set_route_updated_at_update;
CREATE TRIGGER set_route_updated_at_update AFTER UPDATE ON route FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS bump_issue_updated_at_after_attachment_insert;
CREATE TRIGGER bump_issue_updated_at_after_attachment_insert AFTER INSERT ON issue_attachment FOR EACH ROW BEGIN UPDATE issue SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.issue_id; END;

DROP TRIGGER IF EXISTS bump_issue_updated_at_after_attachment_update;
CREATE TRIGGER bump_issue_updated_at_after_attachment_update AFTER UPDATE ON issue_attachment FOR EACH ROW BEGIN UPDATE issue SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.issue_id OR id = NEW.issue_id; END;

DROP TRIGGER IF EXISTS bump_issue_updated_at_after_attachment_delete;
CREATE TRIGGER bump_issue_updated_at_after_attachment_delete AFTER DELETE ON issue_attachment FOR EACH ROW BEGIN UPDATE issue SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.issue_id; END;

DROP TRIGGER IF EXISTS bump_crag_updated_at_after_attachment_insert;
CREATE TRIGGER bump_crag_updated_at_after_attachment_insert AFTER INSERT ON crag_attachment FOR EACH ROW BEGIN UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.crag_id; END;

DROP TRIGGER IF EXISTS bump_crag_updated_at_after_attachment_update;
CREATE TRIGGER bump_crag_updated_at_after_attachment_update AFTER UPDATE ON crag_attachment FOR EACH ROW BEGIN UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.crag_id OR id = NEW.crag_id; END;

DROP TRIGGER IF EXISTS bump_crag_updated_at_after_attachment_delete;
CREATE TRIGGER bump_crag_updated_at_after_attachment_delete AFTER DELETE ON crag_attachment FOR EACH ROW BEGIN UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.crag_id; END;

DROP TRIGGER IF EXISTS bump_sector_updated_at_after_attachment_insert;
CREATE TRIGGER bump_sector_updated_at_after_attachment_insert AFTER INSERT ON sector_attachment FOR EACH ROW BEGIN UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.sector_id; END;

DROP TRIGGER IF EXISTS bump_sector_updated_at_after_attachment_update;
CREATE TRIGGER bump_sector_updated_at_after_attachment_update AFTER UPDATE ON sector_attachment FOR EACH ROW BEGIN UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.sector_id OR id = NEW.sector_id; END;

DROP TRIGGER IF EXISTS bump_sector_updated_at_after_attachment_delete;
CREATE TRIGGER bump_sector_updated_at_after_attachment_delete AFTER DELETE ON sector_attachment FOR EACH ROW BEGIN UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.sector_id; END;

DROP TRIGGER IF EXISTS bump_route_updated_at_after_attachment_insert;
CREATE TRIGGER bump_route_updated_at_after_attachment_insert AFTER INSERT ON route_attachment FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.route_id; END;

DROP TRIGGER IF EXISTS bump_route_updated_at_after_attachment_update;
CREATE TRIGGER bump_route_updated_at_after_attachment_update AFTER UPDATE ON route_attachment FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.route_id OR id = NEW.route_id; END;

DROP TRIGGER IF EXISTS bump_route_updated_at_after_attachment_delete;
CREATE TRIGGER bump_route_updated_at_after_attachment_delete AFTER DELETE ON route_attachment FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.route_id; END;

DROP TRIGGER IF EXISTS bump_topo_parent_updated_at_after_attachment_update;
CREATE TRIGGER bump_topo_parent_updated_at_after_attachment_update AFTER UPDATE ON topo_attachment FOR EACH ROW BEGIN
  UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT crag_id FROM crag_attachment WHERE attachment_id = NEW.id);
  UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT sector_id FROM sector_attachment WHERE attachment_id = NEW.id);
  UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT route_id FROM route_attachment WHERE attachment_id = NEW.id);
END;

DROP TRIGGER IF EXISTS bump_topo_parent_updated_at_before_attachment_delete;
CREATE TRIGGER bump_topo_parent_updated_at_before_attachment_delete BEFORE DELETE ON topo_attachment FOR EACH ROW BEGIN
  UPDATE crag SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT crag_id FROM crag_attachment WHERE attachment_id = OLD.id);
  UPDATE sector SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT sector_id FROM sector_attachment WHERE attachment_id = OLD.id);
  UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT route_id FROM route_attachment WHERE attachment_id = OLD.id);
END;
