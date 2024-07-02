-- Migration number: 0029 	 2024-07-02T03:24:04.308Z
DROP TABLE IF EXISTS "user_invites";
CREATE TABLE "user_invites" (
    "email" TEXT NOT NULL,
    "role" TEXT,
    "token" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "token_expires" TIMESTAMP,
    "invited_by_uid" TEXT NOT NULL,
    "invited_by_name" TEXT NOT NULL
);