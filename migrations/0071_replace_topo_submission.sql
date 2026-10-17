-- Migration number: 0071 	 2026-10-16T23:25:51.557Z

-- topo_submission was never used. Submissions are now a queue: a row exists only
-- while it waits for review, and decisions are kept in audit_log.
DROP TABLE IF EXISTS "topo_submission";

CREATE TABLE "submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uid" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
);

CREATE INDEX "submission_uid_index" ON "submission"("uid");
CREATE INDEX "submission_created_at_index" ON "submission"("created_at");
