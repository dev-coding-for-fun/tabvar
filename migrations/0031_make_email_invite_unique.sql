-- Migration number: 0031 	 2024-07-02T03:51:27.248Z
DROP TABLE IF EXISTS "user_invite";
CREATE TABLE "user_invite" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT,
    "role" TEXT,
    "token" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "token_expires" TIMESTAMP,
    "invited_by_uid" TEXT NOT NULL,
    "invited_by_name" TEXT NOT NULL
);