-- Migration number: 0053 	 2025-09-01T19:53:34.125Z

CREATE TABLE campaign (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    end_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campaign_candidate (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaign(id) ON DELETE CASCADE
);

CREATE TABLE vote (
    campaign_id INTEGER NOT NULL,
    uid TEXT NOT NULL,
    campaign_candidate_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campaign_id, uid),
    FOREIGN KEY (campaign_id) REFERENCES campaign(id) ON DELETE CASCADE,
    FOREIGN KEY (uid) REFERENCES user(uid),
    FOREIGN KEY (campaign_candidate_id) REFERENCES campaign_candidate(id) ON DELETE CASCADE
);