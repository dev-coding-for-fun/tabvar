#!/usr/bin/env node

/**
 * Seeding script for Supporters campaign (Super Supporter 2026).
 *
 * Reads supporters.txt (list of emails, one per line):
 * 1) If the email exists as a user today and isn't tagged with super_supporter_2026,
 *    adds the tag assignment with expiry Sept 1, 2027.
 * 2) If the email does not exist as a user, creates a user_invite entry (role: anonymous),
 *    and links the super_supporter_2026 tag in user_invite_tag with expiry Sept 1, 2027.
 *
 * Usage:
 *   node scripts/seed-supporters.mjs --remote [--dry-run]
 *   node scripts/seed-supporters.mjs --local [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isDryRun = args.includes('--dry-run');
const targetFlag = isRemote ? '--remote' : '--local';

const TAG_NAME = 'super_supporter_2026';
const EXPIRY_DATE = '2027-09-01 00:00:00';
const ADMIN_UID = '111783915643625669656';
const ADMIN_NAME = 'Devin';
const FILE_PATH = path.resolve('supporters.txt');

if (!fs.existsSync(FILE_PATH)) {
  console.error(`Error: ${FILE_PATH} not found.`);
  process.exit(1);
}

const rawEmails = fs.readFileSync(FILE_PATH, 'utf-8')
  .split(/\r?\n/)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const uniqueEmails = [...new Set(rawEmails)];
console.log(`======================================================`);
console.log(`[Seed Supporters] Target: ${isRemote ? 'REMOTE (Cloudflare Production)' : 'LOCAL (Miniflare)'}`);
console.log(`[Seed Supporters] Dry run: ${isDryRun ? 'YES' : 'NO'}`);
console.log(`[Seed Supporters] Loaded ${uniqueEmails.length} unique emails from supporters.txt`);
console.log(`======================================================\n`);

function executeD1Json(command) {
  const output = execSync(`npx wrangler d1 execute DB ${targetFlag} --json --command "${command.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
  });
  return JSON.parse(output)[0].results;
}

// 1. Fetch tag id
console.log(`Looking up tag "${TAG_NAME}"...`);
const tags = executeD1Json(`SELECT id, name FROM user_tag WHERE name = '${TAG_NAME}';`);
if (!tags || tags.length === 0) {
  console.error(`Tag "${TAG_NAME}" not found in database! Please ensure user_tag exists.`);
  process.exit(1);
}
const tagId = Number(tags[0].id);
console.log(`Found tag "${TAG_NAME}" with ID: ${tagId}\n`);

// 2. Fetch existing users
console.log(`Fetching existing users...`);
const users = executeD1Json(`SELECT uid, email FROM user;`);
const userMap = new Map();
for (const u of users) {
  if (u.email) {
    userMap.set(u.email.trim().toLowerCase(), u.uid);
  }
}

// 3. Fetch existing tag assignments for this tag
console.log(`Fetching existing tag assignments for tag ${tagId}...`);
const tagAssignments = executeD1Json(`SELECT uid, expires_at FROM user_tag_assignment WHERE tag_id = ${tagId};`);
const userTagAssignmentMap = new Map();
for (const ta of tagAssignments) {
  userTagAssignmentMap.set(ta.uid, ta.expires_at);
}

// 4. Fetch existing invites
console.log(`Fetching existing invites...`);
const invites = executeD1Json(`SELECT email, role FROM user_invite;`);
const inviteMap = new Map();
for (const inv of invites) {
  if (inv.email) {
    inviteMap.set(inv.email.trim().toLowerCase(), inv);
  }
}

// 5. Fetch existing user_invite_tag records
console.log(`Fetching existing invite tags...`);
const inviteTags = executeD1Json(`SELECT email, tag_id, expires_at FROM user_invite_tag WHERE tag_id = ${tagId};`);
const inviteTagMap = new Map();
for (const it of inviteTags) {
  inviteTagMap.set(it.email.trim().toLowerCase(), it.expires_at);
}

const statements = [];
let existingUsersToTag = 0;
let existingUsersAlreadyTagged = 0;
let newInvitesToCreate = 0;
let existingInvitesToTag = 0;
let alreadyInvitedAndTagged = 0;

for (const email of uniqueEmails) {
  if (userMap.has(email)) {
    const uid = userMap.get(email);
    if (userTagAssignmentMap.has(uid)) {
      existingUsersAlreadyTagged++;
      // Update expiry if different
      statements.push(`UPDATE user_tag_assignment SET expires_at = '${EXPIRY_DATE}' WHERE uid = '${uid}' AND tag_id = ${tagId};`);
    } else {
      existingUsersToTag++;
      statements.push(
        `INSERT INTO user_tag_assignment (uid, tag_id, expires_at, assigned_by_uid, created_at, updated_at) VALUES ('${uid}', ${tagId}, '${EXPIRY_DATE}', '${ADMIN_UID}', DATETIME('now'), DATETIME('now'));`
      );
    }
  } else {
    if (!inviteMap.has(email)) {
      newInvitesToCreate++;
      statements.push(
        `INSERT OR IGNORE INTO user_invite (email, role, token_expires, invited_by_uid, invited_by_name) VALUES ('${email}', 'anonymous', '${EXPIRY_DATE}', '${ADMIN_UID}', '${ADMIN_NAME}');`
      );
    }

    if (!inviteTagMap.has(email)) {
      existingInvitesToTag++;
      statements.push(
        `INSERT OR REPLACE INTO user_invite_tag (email, tag_id, expires_at, created_at) VALUES ('${email}', ${tagId}, '${EXPIRY_DATE}', DATETIME('now'));`
      );
    } else {
      alreadyInvitedAndTagged++;
      statements.push(
        `UPDATE user_invite_tag SET expires_at = '${EXPIRY_DATE}' WHERE email = '${email}' AND tag_id = ${tagId};`
      );
    }
  }
}

console.log(`\n--- SUMMARY OF ACTIONS ---`);
console.log(`- Existing users getting tag: ${existingUsersToTag}`);
console.log(`- Existing users already tagged (updating expiry): ${existingUsersAlreadyTagged}`);
console.log(`- Non-users getting new invite: ${newInvitesToCreate}`);
console.log(`- Non-users getting invite tag pre-added: ${existingInvitesToTag}`);
console.log(`- Total SQL statements to execute: ${statements.length}`);

if (isDryRun) {
  console.log(`\n[Dry Run] Skipping database execution. Example statements:\n`);
  console.log(statements.slice(0, 5).join('\n'));
  console.log(`... and ${statements.length - 5} more.`);
  process.exit(0);
}

if (statements.length === 0) {
  console.log('\nNo updates needed. All records are up to date!');
  process.exit(0);
}

// Write to temporary SQL file and execute in batch
const tempSqlPath = path.resolve('./temp_seed_supporters.sql');
fs.writeFileSync(tempSqlPath, statements.join('\n'), 'utf-8');

try {
  console.log(`\nExecuting batch SQL (${statements.length} statements) via Wrangler...`);
  execSync(`npx wrangler d1 execute DB ${targetFlag} --file "${tempSqlPath}"`, {
    stdio: 'inherit',
  });
  console.log(`\n======================================================`);
  console.log(`[Seed Supporters] Successfully applied all supporter records!`);
  console.log(`======================================================\n`);
} finally {
  if (fs.existsSync(tempSqlPath)) {
    fs.unlinkSync(tempSqlPath);
  }
}
