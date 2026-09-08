-- Migration number: 0061 	 2026-09-08T10:25:00.000Z
-- Adds user_tag and user_tag_assignment tables with expiration support

CREATE TABLE "user_tag" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "color" TEXT DEFAULT 'blue',
    "created_at" DATETIME DEFAULT (DATETIME('now')),
    "updated_at" DATETIME DEFAULT (DATETIME('now'))
);

CREATE TRIGGER IF NOT EXISTS "trigger_user_tag_updated_at"
AFTER UPDATE ON "user_tag"
FOR EACH ROW
BEGIN
    UPDATE "user_tag" SET "updated_at" = DATETIME('now') WHERE "id" = OLD.id;
END;

CREATE TABLE "user_tag_assignment" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "expires_at" DATETIME,
    "assigned_by_uid" TEXT,
    "created_at" DATETIME DEFAULT (DATETIME('now')),
    "updated_at" DATETIME DEFAULT (DATETIME('now')),
    FOREIGN KEY("uid") REFERENCES "user"("uid") ON DELETE CASCADE,
    FOREIGN KEY("tag_id") REFERENCES "user_tag"("id") ON DELETE CASCADE,
    FOREIGN KEY("assigned_by_uid") REFERENCES "user"("uid") ON DELETE SET NULL,
    UNIQUE("uid", "tag_id")
);

CREATE TRIGGER IF NOT EXISTS "trigger_user_tag_assignment_updated_at"
AFTER UPDATE ON "user_tag_assignment"
FOR EACH ROW
BEGIN
    UPDATE "user_tag_assignment" SET "updated_at" = DATETIME('now') WHERE "id" = OLD.id;
END;

CREATE INDEX IF NOT EXISTS "idx_user_tag_assignment_uid" ON "user_tag_assignment"("uid");
CREATE INDEX IF NOT EXISTS "idx_user_tag_assignment_tag_id" ON "user_tag_assignment"("tag_id");
CREATE INDEX IF NOT EXISTS "idx_user_tag_assignment_expires_at" ON "user_tag_assignment"("expires_at");
