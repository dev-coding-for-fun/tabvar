-- Migration number: 0052 	 2025-06-14T23:01:29.967Z
ALTER TABLE "issue" ADD COLUMN claimed_by_uid TEXT;
ALTER TABLE "issue" ADD CONSTRAINT "issue_claimant_uid_fk" FOREIGN KEY ("claimed_by_uid") REFERENCES "user"("uid");

CREATE INDEX "issue_claimed_by_uid_index" ON "issue"("claimed_by_uid");
