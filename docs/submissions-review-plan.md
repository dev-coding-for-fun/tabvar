# Submissions review implementation plan

Status: proposed implementation plan. No application changes are included.

## Goal and boundaries

Rebuild `/admin/submissions` as the entry point for reviewing incoming route and topo data and issue reports. Present three separate queues: **TopoBuilder**, **Issue reports**, and **AI updates**. Review one submission at a time; do not provide a combined feed or approval across queues.

Human and AI route submissions use the same changeset contract and publication service. Their source and supporting evidence differ. Issue reports retain their existing domain model, moderation rules, and repair lifecycle.

Simplicity takes priority over exhaustive safeguards. There is no bulk approval requirement. Process one approval at a time with straightforward database operations; a future **Approve all** control can call the same operation sequentially and report each result independently. The database is quiet enough that live arrival handling, review locks, optimistic concurrency checks, and transactions spanning multiple approvals are unnecessary.

Published route data lives in the primary tables only. Store the submitted fields and compare them with those tables when opening a review. Do not save original route copies, intake snapshots, before/after route values, or historical route versions. Use timestamps for advisory stale-change warnings; the reviewer decides whether to proceed.

The user confirmed that `topo_submission` is empty and the submission system is not in use yet. Its schema can be replaced by dropping the old table in a new migration. No submission backfill, legacy-data repair, or legacy payload compatibility layer is required. This permission is limited to submission data; retain published routes, topos, attachments, users, and issues.

Deliver this in the requested order:

1. Submission data model, intake API, publication service, and companion TopoBuilder changes.
2. The review page and issue review integration.
3. Conflict detection and resolution.

AI ingestion, Google Docs access, document extraction, and automated publication are outside this project. Build the shared contract and the empty AI queue now; implement its producer separately.

## Findings from the current implementation

- `app/routes/admin.submissions.tsx` loads `topo_submission` and displays its JSON payload. It permits `admin` and `super` users, but has no review actions.
- `app/lib/submission.server.ts` accepts crag/sector/topo trees and stores uploaded images under a submission prefix in R2. It requires at least one topo, uses permissive payload types, and does not resolve entities or calculate changes.
- `topo_submission` already has reviewer, review timestamp, and notes columns. It lacks a structured proposal model, source classification, and applied entity mappings.
- TopoBuilder currently calls `/api/topobuilder/submissions`. Its submission builder sends route names and grades and references routes by name. It omits linked TABVAR catalog routes, most route fields, annotations, and stable topo identity. It uploads the original photo rather than the rendered topo.
- A separate `/api/v1/topos` API publishes raw topos and can create routes immediately. The inspected TopoBuilder submission flow does not call it. Its existing write contract needs an explicit policy so the new queue cannot be bypassed accidentally.
- `app/routes/issues.manage.tsx` already supports issue moderation, edits, attachment display, and status history. `app/lib/issues.server.ts` supplies shared mutations and audit logging. Some reports become public without admin review.
- The installed D1 Kysely dialect buffers transaction queries into a batch and returns no intermediate rows or insert IDs. Use straightforward writes and obtain generated IDs outside a buffered transaction rather than designing a complex whole-submission batch.
- User deletion currently refers directly to `topo_submission`; schema changes must update this integration and its tests.

## Working decisions

- Preserve `/admin/submissions` and its `admin`/`super` access policy. Enforce permissions on loaders and actions. Make the review navigation available to both roles while keeping other admin-only links restricted.
- Use `human` and `ai` source categories independently of origin, such as `topobuilder` or a future claim-form importer. Set source from trusted server integration identity, not an arbitrary request field.
- Keep the submitted proposal and any reviewer corrections, mappings, and decisions. Record applied item IDs and status; do not copy the previous published route values into the submission or a new audit table.
- Initially approve or reject a submission as a whole after mappings and corrections. Defer selective merge controls to phase 3. Approval must respect dependencies between new hierarchy records, routes, attachments, and topos.
- Keep each approval independent. Use small per-item transactions where useful; do not require all-or-nothing publication of an entire queue or changeset. Handle failures explicitly and record applied results so remaining work can be retried without recreating successful items.
- Show an advisory stale-change warning using the route's current `updated_at` and a last-seen server timestamp when supplied, or the submission time otherwise. No locking or concurrent reviewer coordination is needed. Competing-submission detection remains in phase 3.
- New/updated route proposals and attachments do not require a topo. A topo-only submission may reference existing routes without proposing changes to them.
- Omitted fields mean unchanged; explicit `null` means clear a nullable field. Existing route references do not imply updates. Initial route operations are create, update, and reference; route deletion is outside this scope.
- **Confirmed issue scope:** only reports in `In Moderation` enter the issue review queue. Use existing statuses, approval/archival metadata, and audit history; no independent issue-review state is needed. Reports already made public by current rules remain in the existing issue workflows.

## Phase 1: submission data and APIs

### 1A. Define and document the changeset contract

Define a versioned contract in canonical submission/domain types, with:

- Submission identity, client request ID for idempotent retry, trusted source/origin, submitter or service account, submission time, and optional source references and evidence.
- Stable item IDs, existing TABVAR numeric IDs where known, client IDs for new entities, and explicit parent and attachment references.
- Explicit create/update/reference operations for routes and the hierarchy needed to place them. Support proposed crags and sectors already present in the current intake contract.
- Route patches restricted to explicitly proposed editable fields, plus the producer's last-seen server `updatedAt` timestamp when available. Do not include a second set of original field values or capture route snapshots at intake.
- Optional topo data: stable UUID, existing server ID where known, metadata, clean background, rendered raster, versioned annotations, and route links with labels and ordering.
- Optional attachments: stored object key, MIME type, original filename, size/hash, purpose, associated items, and whether the file is review evidence or should become a public attachment.
- Provenance usable by a later AI producer: source document/link, reference location or excerpt, and optional field-level evidence. This is a data contract, not an ingestion pipeline.

Matching policy: resolve explicit server IDs first. Names can suggest matches within the specified crag/sector, but ambiguous matches and possible duplicate creates require reviewer mapping. A rename keeps entity identity. Never merge or overwrite a route solely because its name matches.

### 1B. Replace the unused submission schema

Create a new migration that drops the empty `topo_submission` table and creates `submission`, with source, schema version, pending/approved/rejected status, review metadata, and idempotency identity. Add `submission_change` and `submission_attachment` records for proposed fields, target IDs, optional last-seen timestamps, associations, and applied IDs/status. Store proposed fields as JSON. Do not add baseline payloads, original route copies, or stored before/after values. Ensure serialized payload reads preserve exact values: the current database plugin applies HTML decoding to every string, which can alter JSON content.

Keep approved/rejected proposals, reviewer decisions/notes, decision timestamps, and resulting server IDs. History describes what was submitted and accepted; it does not retain previous published route values or promise an exact historical diff. Ensure account deletion handles these records and shared files deliberately, updating the existing schema references and tests.

Do not implement backfill, legacy normalization, preservation of old submission IDs/URLs, or repair UI. Update callers and types to the new schema directly. Published data and the existing issue moderation system remain intact.

Use Wrangler to create the next migration number, apply locally, and regenerate database types. Determine the number at implementation time; unrelated migration work already exists. Do not rewrite existing migrations. Preserve publication tables and unrelated external API contracts.

### 1C. Implement validated, retry-safe intake

Add a shared intake service and `/api/v1/submissions` endpoint, accepting JSON without files and multipart requests with files. Update TopoBuilder to this contract in the same implementation phase. The unused submission flow does not need a legacy tree parser or compatibility adapter; retain the old endpoint path only if a simple alias helps rollout. Keep the response straightforward: `{ id, status }` plus useful validation information when needed.

Validate the complete payload and file references before upload. Check entity IDs, parent relationships, duplicate references, supported fields, annotations, attachment types, and reasonable request/file limits. Allow route-only and attachment-only proposals with valid targets. Reject empty/no-op submissions with a useful explanation.

Use a client request ID to recognize ordinary upload retries; do not build a general exactly-once delivery system. A repeated ID with different content is an error, not a silent replacement. Do not infer retry identity from route names or identical content. Upload only referenced files, persist server-generated object metadata, and clean up files written by failed intake without deleting shared objects. Return validation failures as 4xx and storage/database failures as 5xx.

Add a caller-scoped status/read endpoint reporting review status, notes, and applied ID mappings so the client can distinguish queued submission from publication.

Resolve the existing direct topo-write contract explicitly. Recommended policy: external contributions use the submissions API; any retained direct-write endpoint requires a clearly authorized trusted publishing identity. Do not silently change a response that currently returns a published topo into one returning a pending submission. Update the API documentation and caller tests with the chosen transition.

### 1D. Implement comparison and publication services

Build one comparison service that resolves targets and returns new records, changed fields, unchanged references, attachments, and validation/mapping requirements. Read target records directly from the primary tables and compare their current values with the submitted patch at review time. Generate this diff for display only; do not persist it or retain a copy of the current route.

Implement approve/reject services with reviewer notes and server-side validation. Publication applies only the effective reviewed patch, creates dependencies in order, stores ordinary attachments in the existing attachment/junction model, and stores editable topos in `topo`/`route_topo`. Reuse established validation, storage, timestamp, hierarchy, and search conventions; split existing helpers where needed to avoid repeating uploads or doing unguarded incremental writes.

Process one submission approval using straightforward operations in dependency order. Use small transactions/batches for an individual change where practical, obtaining generated IDs before later operations that need them. Do not require a prebuilt atomic batch for the entire submission or coordination between reviewers. Check the existing decision status and disable the action while it is running as ordinary UI safeguards.

Record successfully applied item IDs/status as work proceeds, without copying the values they replaced. If a later operation fails, return a useful error and leave the submission pending with its progress visible; retry only the remaining operations. Mark the submission approved once its intended work is complete. Do not silently undo successful work or describe a partial result as a complete approval/rejection. A future **Approve all** action can iterate these independent approvals without a shared transaction.

Use assets stored during intake when publishing; publish references only after files are available. Clean up only newly created unreferenced objects after failure. Rejection retains review evidence; destructive retention cleanup is a separate policy. Do not introduce a distributed transaction or asset-promotion workflow merely to coordinate R2 and D1.

When loading a review, warn if the primary record's `updated_at` is newer than the last-seen server timestamp supplied for that item. If none was supplied, compare against the server-recorded submission time and label the warning **Changed since submission**. Normalize timestamps to the same UTC format. This fallback cannot identify changes made before intake, and timestamps do not identify which field changed; a conservative warning is sufficient. Do not block approval or add route fingerprints, automatic mid-review refreshes, or locking. Comparing incompatible proposals is deferred to phase 3.

Verify that approved data appears in public route views and existing route/topo delta sync, including search indexes and attachment/route timestamps.

### 1E. Update the TopoBuilder producer

Update `../topobuilder` submission types, builder, export bundle, upload client, and submission state together:

- Include linked TABVAR routes and their numeric IDs. Preserve local identities rather than deduplicating routes by name.
- Submit supported route metadata and explicit update patches where existing-route editing is supported. Linked unchanged catalog routes remain references. Add a focused edit-proposal flow if the existing editor cannot express changes to catalog routes.
- Include existing crag/sector IDs and stable topo UUIDs, annotations, the original background, and a raster generated through the existing rendering pipeline.
- Submit only fields explicitly edited/proposed, reusing the existing catalog data for display. Include its last-seen server `updatedAt` timestamp when available; do not add an original-route snapshot or version history. If storing the timestamp requires a schema change, follow the companion repository's shipped-schema migration rules; do not rewrite released migrations.
- Generate one persistent request ID per submission attempt, reuse it on retry, and distinguish submitted/pending from approved/published in client state and messaging. Apply returned mappings after approval so later submissions update the same published entities.

Use the existing upload and rendering APIs; no dependency or native configuration changes are planned. Coordinate the server and client contract changes; there is no live submission data or legacy client workflow to migrate.

**Phase 1 acceptance:** a mixed submission containing new routes, route updates, existing references, and optional topos/attachments can be queued, compared, and approved independently. Rejection does not publish changes. Failed operations report their partial progress, and retries do not recreate successfully applied items. The new schema is installed without submission backfill.

## Phase 2: rebuild the review page

### 2A. Add separate queues and a focused review layout

Rename the page and navigation to **Submissions**. Use three tabs with pending counts: **TopoBuilder**, **Issue reports**, and **AI updates**. The AI tab initially explains that no producer is connected. Do not synthesize AI records or add importer settings.

Each tab has its own appropriate filters, search, sorting, empty state, and selected item. Human/AI submissions have pending/approved/rejected status filters; the issue queue contains only `In Moderation` reports and links to the existing issue manager for other statuses and history. Persist tab/filter/selection in URL query parameters for links and refresh. Load complete modest changesets without requiring pagination or virtualization.

On desktop, use a list beside the selected submission; on narrow screens, open the selected item in a single-column detail view. List summaries show location, submitter/source, time, status, and counts of new routes, changed routes, and attachments. Distinguish source with text and an icon as well as color.

### 2B. Build the shared human/AI changeset reviewer

The detail view shows:

- Source, submission context, review history, and summary counts.
- New route cards with proposed metadata; existing route cards with explicit **Current -> Proposed** field comparisons calculated from the primary tables each time the review is loaded. Show the timestamp warning beside an affected record. Collapse unchanged fields and keep unchanged linked routes distinguishable from edits.
- Added/changed crag or sector data and unresolved mapping choices when relevant.
- Attachment thumbnails/previews/downloads, topo background/raster previews, and the routes represented by each topo. Keep source evidence separate from proposed public attachments.
- Corrections and target mapping controls, with required fixes shown next to the affected item. Preserve original versus reviewer-corrected values.
- Approve/reject actions with decision notes, pending state, validation errors, partial-progress/error display, and navigation to the next pending item. History shows the proposal, accepted fields, reviewer, decision time, notes, and resulting IDs. Do not present today's live comparison as an exact historical before/after diff. Bulk approval is optional future UI work.

Human submissions emphasize contributor context and topo imagery. AI submissions emphasize document provenance and supporting evidence, using the same diff and approval components. Do not build AI model controls or require artificial confidence scores.

### 2C. Integrate issue reports

Query only reports whose current status is `In Moderation`. Reuse issue models, attachment components, mutation services, and audit history. Present route/location, description, taxonomy, affected bolts, safety flag, attachments, and report/status history. Every existing moderated report is eligible; no issue backfill or separate review-state table is necessary.

Offer edits, accept to `Reported`, and archive through the existing mutation services, preserving approval/archival actor metadata and audit logging. Remove decided reports from the queue after normal action revalidation; no stale-content guard or concurrency mechanism is required. Reports already public or completed do not enter this queue. Repair actions such as completion remain in `/issues/manage`; include a link to that workflow and its history. Preserve current automatic publication and member workflows.

Keep `/issues/manage` available, especially for member repair workflows. Extract shared pieces rather than maintaining a second copy of its moderation logic. The existing modal posts to its current route; adapt its action target when reused.

**Phase 2 acceptance:** an admin can review and decide a complete TopoBuilder submission and an issue report from one page, understand each proposed field change, inspect attachments, and find decision history. Tabs stay separate and AI has a ready empty queue.

## Phase 3: conflict detection and resolution

Use the target identities, proposed fields, and timestamps introduced in phase 1. Compare pending proposals with the current primary records and with other pending proposals across human and AI sources, even though their queues remain separate. Do not add saved originals or a three-way merge model.

For each explicitly proposed field, compare current and proposed values, and the corresponding fields in other pending proposals:

- Different fields changed on the same route: compatible if structural constraints permit both.
- Same field changed to the same value: compatible/already satisfied.
- Same field changed to different values: requires resolution.
- Primary record newer than the last-seen timestamp or submission time: show the advisory stale-change warning. It does not prove a particular field was changed incompatibly.
- Missing/deleted targets, incompatible hierarchy changes, duplicate route creation, and incompatible topo/link changes: explicit structural conflicts.

Add conflict counts and a warning on the affected submission/route/field. Show **Current | This proposal | Other proposal**, with links to the other submissions and their sources. Show relevant record/submission timestamps for context. Cross-source conflicts are visible without combining the queues.

Allow keeping the current value, choosing the proposal, or entering a corrected value. Allow mapping a duplicate create to an existing route and rejecting conflicting portions, respecting dependent topo and attachment links. Define an explicit partially-approved outcome with item decisions and skipped-change reasons so history and client status remain truthful.

Resolve each submission independently; do not introduce a bulk merge of submissions. Store resolution choices and reviewer rationale separately from original proposals. Recalculate conflicts when opening an affected submission after a decision, using ordinary request/revalidation behavior. Do not introduce live monitoring, revision locks, or atomic coordination across submissions; reassess those only if actual usage warrants them.

**Phase 3 acceptance:** compatible patches preserve unrelated fields, competing values are highlighted for a reviewer to decide, and stale proposals have a timestamp warning. Decisions and chosen proposal values remain recorded without storing original route copies. Humans and AI use the same comparison rules.

## Verification and delivery

Use focused Vitest tests and `app/test/helpers.ts` for intake, mapping/diffs, individual approvals, permissions, issue review, and route actions. Use existing SQLite integration-test conventions for schema replacement, foreign keys, hierarchy/search/timestamp triggers, and the small transactions actually used. Validate those operations against local D1 where its behavior differs from the installed mocks or SQLite driver.

Meaningful regression cases include live diffs reflecting primary-table updates, advisory timestamp warnings with and without a last-seen timestamp, omitted versus cleared values, renamed routes, same-name routes in different sectors, shared route references across topos, linked catalog routes, route-only submissions, ambiguous mapping, invalid payloads, ordinary retries, failed upload/write with accurate partial progress, already-decided submissions, issue filtering to `In Moderation`, and appropriate account-deletion handling. Do not add legacy backfill, stored-baseline reconstruction, mid-review arrival, or concurrent approval tests. Phase 3 adds field-level and structural conflict cases.

After each implementation slice, run `npm run verify` in tabvar using the pinned Node/npm versions. Run `npm run build` for API/UI/runtime integration changes. In TopoBuilder run typecheck and Jest; run its Playwright web checks for changed UI or web behavior. Inspect the final admin UI at desktop and narrow widths with empty, pending, error, and reviewed states.

Deliver the new submission schema and contract together with the TopoBuilder producer changes. Publish the review UI after the shared services are tested. Add conflict tools after phases 1-2 work end to end. Update the submission, topo sync, route sync, and issue sync documentation as their contracts change. Production migration/deployment is a separate approved step.
