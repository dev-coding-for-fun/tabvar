-- Migration number: 0056 	 2026-06-03T09:05:00.000Z

CREATE TABLE "topobuilder_connect_ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uid" TEXT NOT NULL,
    "ticket_hash" TEXT NOT NULL UNIQUE,
    "return_to" TEXT NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP NOT NULL,
    "used_at" TIMESTAMP,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
);

CREATE TABLE "api_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uid" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "name" TEXT,
    "token_hash" TEXT NOT NULL UNIQUE,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP,
    "expires_at" TIMESTAMP,
    "revoked_at" TIMESTAMP,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
);

CREATE INDEX "topobuilder_connect_ticket_uid_index" ON "topobuilder_connect_ticket"("uid");
CREATE INDEX "topobuilder_connect_ticket_expires_at_index" ON "topobuilder_connect_ticket"("expires_at");
CREATE INDEX "api_token_uid_index" ON "api_token"("uid");
CREATE INDEX "api_token_client_index" ON "api_token"("client");
