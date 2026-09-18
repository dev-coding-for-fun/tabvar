-- Migration number: 0067 	 2026-09-18T04:31:56.076Z
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_email_unique" ON "user"("email" COLLATE NOCASE);
