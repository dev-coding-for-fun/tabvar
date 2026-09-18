-- Migration number: 0068 	 2026-09-18T05:02:34.000Z
ALTER TABLE "user_invite_tag" ADD COLUMN "expires_at" DATETIME;
