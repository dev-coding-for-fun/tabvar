-- Migration number: 0030 	 2024-07-02T03:36:23.465Z
DROP TABLE IF EXISTS "user_invites";
CREATE TABLE "user_invite" (
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" TEXT,
    "token" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "token_expires" TIMESTAMP,
    "invited_by_uid" TEXT NOT NULL,
    "invited_by_name" TEXT NOT NULL
);