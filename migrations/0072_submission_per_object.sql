-- Migration number: 0072 	 2026-10-19T05:07:00.657Z

-- One row per account and object: the account's latest proposal for that object,
-- and afterwards the link between the app's own id for it (ref) and the TABVAR
-- record (target_id). Replaces the per-set queue, which never held data.
DROP TABLE IF EXISTS "submission";

CREATE TABLE "submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    -- The app's own id for an object it proposed as new.
    "ref" TEXT,
    -- The TABVAR record: the one being edited, or the one created on approval.
    "target_id" INTEGER,
    -- The latest proposed fields (JSON).
    "fields" TEXT NOT NULL,
    "base_updated_at" TEXT,
    -- pending, published, or rejected.
    "state" TEXT NOT NULL,
    "error" TEXT,
    "received_at" TEXT NOT NULL,
    "decided_at" TEXT,
    "updated_at" TEXT NOT NULL,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
);

CREATE UNIQUE INDEX "submission_uid_ref_index" ON "submission"("uid", "ref") WHERE "ref" IS NOT NULL;
CREATE UNIQUE INDEX "submission_uid_target_index" ON "submission"("uid", "entity", "target_id") WHERE "target_id" IS NOT NULL;
CREATE INDEX "submission_state_index" ON "submission"("state");
CREATE INDEX "submission_uid_updated_at_index" ON "submission"("uid", "updated_at");
