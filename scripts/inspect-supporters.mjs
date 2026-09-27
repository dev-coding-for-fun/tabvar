import fs from 'node:fs';
import { execSync } from 'node:child_process';

const rawEmails = fs.readFileSync('supporters.txt', 'utf-8')
  .split('\n')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const uniqueEmails = [...new Set(rawEmails)];
console.log(`Loaded ${uniqueEmails.length} unique emails from supporters.txt (raw lines: ${rawEmails.length})`);

// Fetch existing users from remote D1
console.log('Fetching users from remote D1...');
const usersJson = execSync('npx wrangler d1 execute DB --remote --json --command "SELECT uid, email, display_name FROM user;"', { encoding: 'utf-8' });
const users = JSON.parse(usersJson)[0].results;
const userMap = new Map();
for (const u of users) {
  if (u.email) {
    userMap.set(u.email.trim().toLowerCase(), u);
  }
}

// Fetch existing tag assignments for tag_id = 1 (super_supporter_2026)
console.log('Fetching existing tag assignments for super_supporter_2026...');
const tagAssignmentsJson = execSync('npx wrangler d1 execute DB --remote --json --command "SELECT uid, tag_id, expires_at FROM user_tag_assignment WHERE tag_id = 1;"', { encoding: 'utf-8' });
const tagAssignments = JSON.parse(tagAssignmentsJson)[0].results;
const taggedUids = new Set(tagAssignments.map(ta => ta.uid));

// Fetch existing invites from remote D1
console.log('Fetching existing invites from remote D1...');
const invitesJson = execSync('npx wrangler d1 execute DB --remote --json --command "SELECT email, role FROM user_invite;"', { encoding: 'utf-8' });
const invites = JSON.parse(invitesJson)[0].results;
const inviteMap = new Map();
for (const inv of invites) {
  if (inv.email) {
    inviteMap.set(inv.email.trim().toLowerCase(), inv);
  }
}

// Fetch existing invite tags for tag_id = 1
console.log('Fetching existing user_invite_tag records...');
const inviteTagsJson = execSync('npx wrangler d1 execute DB --remote --json --command "SELECT email, tag_id FROM user_invite_tag WHERE tag_id = 1;"', { encoding: 'utf-8' });
const inviteTags = JSON.parse(inviteTagsJson)[0].results;
const inviteTaggedEmails = new Set(inviteTags.map(it => it.email.trim().toLowerCase()));

let existingUsersNotTagged = [];
let existingUsersAlreadyTagged = [];
let notUsersExistingInvite = [];
let notUsersNewInvite = [];

for (const email of uniqueEmails) {
  if (userMap.has(email)) {
    const user = userMap.get(email);
    if (taggedUids.has(user.uid)) {
      existingUsersAlreadyTagged.push({ email, uid: user.uid });
    } else {
      existingUsersNotTagged.push({ email, uid: user.uid });
    }
  } else {
    if (inviteMap.has(email)) {
      notUsersExistingInvite.push({ email, hasTag: inviteTaggedEmails.has(email) });
    } else {
      notUsersNewInvite.push(email);
    }
  }
}

console.log('\n--- ANALYSIS RESULTS ---');
console.log(`1. Existing users to be tagged: ${existingUsersNotTagged.length}`);
console.log(`2. Existing users already tagged: ${existingUsersAlreadyTagged.length}`);
console.log(`3. Non-users with existing invite: ${notUsersExistingInvite.length}`);
console.log(`4. Non-users needing new invite + tag: ${notUsersNewInvite.length}`);
console.log(`Total supporters: ${existingUsersNotTagged.length + existingUsersAlreadyTagged.length + notUsersExistingInvite.length + notUsersNewInvite.length}`);
