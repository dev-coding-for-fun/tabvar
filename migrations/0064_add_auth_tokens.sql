-- Migration number: 0064 	 2026-09-18T02:45:00.000Z
CREATE TABLE IF NOT EXISTS "auth_token" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "expires_at" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME DEFAULT (DATETIME('now'))
);

CREATE INDEX IF NOT EXISTS "idx_auth_token_email" ON "auth_token"("email");
CREATE INDEX IF NOT EXISTS "idx_auth_token_token" ON "auth_token"("token");
CREATE INDEX IF NOT EXISTS "idx_user_email" ON "user"("email");
