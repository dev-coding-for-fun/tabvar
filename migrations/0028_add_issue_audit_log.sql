-- Migration number: 0028 	 2024-07-01T18:09:32.390Z
DROP INDEX IF EXISTS "route_crag_id_index";
ALTER TABLE "issue" DROP COLUMN image_url;

DROP TABLE IF EXISTS "issue_audit_log";
CREATE TABLE "issue_audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "uid" TEXT,
    "user_display_name" TEXT,
    "user_role" TEXT,
    "issue_id" INTEGER NOT NULL,
    "before_route_id" INTEGER,
    "after_route_id" INTEGER,
    "before_issue_type" TEXT,
    "after_issue_type" TEXT,
    "before_sub_issue_type" TEXT,
    "after_sub_issue_type" TEXT,
    "before_bolts_affected" TEXT,
    "after_bolts_affected" TEXT,
    "before_status" TEXT,
    "after_status" TEXT,
    "before_description" TEXT,
    "after_description" TEXT,
    "before_is_flagged" INTEGER,
    "after_is_flagged" INTEGER,
    "before_flagged_message" TEXT,
    "after_flagged_message" TEXT,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS "attachment_audit_log";
CREATE TABLE "attachment_audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "uid" TEXT,
    "user_display_name" TEXT,
    "user_role" TEXT,
    "attachment_id" INTEGER NOT NULL,
    "issue_id" INTEGER,
    "before_name" TEXT,
    "after_name" TEXT,
    "type" TEXT,
    "url" TEXT,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);