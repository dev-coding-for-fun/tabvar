-- Migration number: 0057 	 2026-06-03T15:00:00.000Z

CREATE TABLE "topo_submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uid" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_uid" TEXT,
    "reviewed_at" TIMESTAMP,
    "review_notes" TEXT,
    FOREIGN KEY("uid") REFERENCES "user"("uid"),
    FOREIGN KEY("reviewed_by_uid") REFERENCES "user"("uid")
);

CREATE INDEX "topo_submission_status_index" ON "topo_submission"("status");
CREATE INDEX "topo_submission_uid_index" ON "topo_submission"("uid");
CREATE INDEX "topo_submission_created_at_index" ON "topo_submission"("created_at");
