-- Migration number: 0065 	 2026-09-18T03:36:33.367Z
-- Creates user_discount_code table for pool of discount QR codes

CREATE TABLE IF NOT EXISTS "user_discount_code" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "code_key" TEXT NOT NULL UNIQUE,
    "claimed_email" TEXT UNIQUE,
    "claimed_uid" TEXT,
    "claimed_at" DATETIME,
    "created_at" DATETIME DEFAULT (DATETIME('now'))
);

CREATE INDEX IF NOT EXISTS "idx_user_discount_code_claimed_email" ON "user_discount_code"("claimed_email");
CREATE INDEX IF NOT EXISTS "idx_user_discount_code_claimed_uid" ON "user_discount_code"("claimed_uid");

INSERT OR IGNORE INTO "user_tag" ("name", "description", "color")
VALUES ('super_supporter_2026', 'Eligible for 2026 supporter discount QR code', 'teal');

