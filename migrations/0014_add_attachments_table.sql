-- Migration number: 0014 	 2024-05-25T06:21:28.290Z
DROP TABLE IF EXISTS "issue_attachment";
CREATE TABLE "issue_attachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issue_id" NUMBER NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("issue_id") REFERENCES issue("id") ON DELETE CASCADE
);

CREATE INDEX "attachment_issue_id_index" ON "issue_attachment"("issue_id");