-- Migration number: 0015 	 2024-06-09T20:13:17.439Z
DROP INDEX IF EXISTS "attachment_issue_id_index";
ALTER TABLE issue_attachment RENAME TO issue_attachment_old;

CREATE TABLE "issue_attachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("issue_id") REFERENCES issue("id") ON DELETE CASCADE
);

CREATE INDEX "attachment_issue_id_index" ON "issue_attachment"("issue_id");

INSERT INTO "issue_attachment" SELECT * FROM issue_attachment_old;

DROP TABLE issue_attachment_old;