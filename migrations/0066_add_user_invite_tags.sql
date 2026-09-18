-- Migration number: 0066 	 2026-09-18T04:22:30.740Z
-- Adds user_invite_tag table to associate pending email invitations with user tags

CREATE TABLE IF NOT EXISTS "user_invite_tag" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "created_at" DATETIME DEFAULT (DATETIME('now')),
    FOREIGN KEY("email") REFERENCES "user_invite"("email") ON DELETE CASCADE,
    FOREIGN KEY("tag_id") REFERENCES "user_tag"("id") ON DELETE CASCADE,
    UNIQUE("email", "tag_id")
);

CREATE INDEX IF NOT EXISTS "idx_user_invite_tag_email" ON "user_invite_tag"("email");
CREATE INDEX IF NOT EXISTS "idx_user_invite_tag_tag_id" ON "user_invite_tag"("tag_id");
