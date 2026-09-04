-- Migration number: 0060 	 2026-09-04T10:00:00.000Z
-- Adds file_hash and file_size columns and lookup indexes to issue_attachment and topo_attachment.

ALTER TABLE "issue_attachment" ADD COLUMN "file_hash" TEXT;
ALTER TABLE "issue_attachment" ADD COLUMN "file_size" INTEGER;

ALTER TABLE "topo_attachment" ADD COLUMN "file_hash" TEXT;
ALTER TABLE "topo_attachment" ADD COLUMN "file_size" INTEGER;

CREATE INDEX IF NOT EXISTS "idx_issue_attachment_file_hash" ON "issue_attachment"("file_hash");
CREATE INDEX IF NOT EXISTS "idx_topo_attachment_file_hash" ON "topo_attachment"("file_hash");
