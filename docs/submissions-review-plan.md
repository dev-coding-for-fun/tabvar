# Submissions review implementation plan

Status: proposed implementation plan. No application changes are included.

## Goal and boundaries

Rebuild `/admin/submissions` as the entry point for reviewing incoming route and topo data and issue reports. Present three separate queues: **TopoBuilder**, **Issue reports**, and **AI updates**. Review one submission at a time; do not provide a combined feed or approval across queues.

Human and AI route submissions use the same changeset contract and publication service. Their source and supporting evidence differ. Issue reports retain their existing domain model, moderation rules, and repair lifecycle.

Deliver this in the requested order:

1. Submission data model, intake API, publication service, and companion TopoBuilder changes.
2. The review page and issue review integration.
3. Conflict detection and resolution.

AI ingestion, Google Docs access, document extraction, and automated publication are outside this project. Build the shared contract and the empty AI queue now; implement its producer separately.

## Findings from the current implementation

- `app/routes/admin.submissions.tsx` loads `topo_submission` and displays its JSON payload. It permits `admin` and `super` users, but has no review actions.
- `app/lib/submission.server.ts` accepts crag/sector/topo trees and stores uploaded images under a submission prefix in R2. It requires at least one topo, uses permissive payload types, and does not resolve entities or calculate changes.
- `topo_submission` already has reviewer, review timestamp, and notes columns. It lacks a structured change model, source classification, baselines, and applied entity mappings.
- TopoBuilder currently calls `/api/topobuilder/submissions`. Its submission builder sends route names and grades and references routes by name. It omits linked TABVAR catalog routes, most route fields, annotations, and stable topo identity. It uploads the original photo rather than the rendered topo.
- A separate `/api/v1/topos` API publishes raw topos and can create routes immediately. The inspected TopoBuilder submission flow does not call it. Its existing write contract needs an explicit policy so the new queue cannot be bypassed accidentally.
- `app/routes/issues.manage.tsx` already supports issue moderation, edits, attachment display, and status history. `app/lib/issues.server.ts` supplies shared mutations and audit logging. Some reports become public without admin review.
- The installed D1 Kysely dialect buffers transaction queries into a batch and returns no intermediate rows or insert IDs. Publication cannot depend on selecting or obtaining generated IDs inside an ordinary transaction callback.
- User deletion currently refers directly to `topo_submission`; schema changes must update this integration and its tests.

## Working decisions

- Preserve `/admin/submissions` and its `admin`/`super` access policy. Enforce permissions on loaders and actions. Make the review navigation available to both roles while keeping other admin-only links restricted.
- Use `human` and `ai` source categories independently of origin, such as `topobuilder` or a future claim-form importer. Set source from trusted server integration identity, not an arbitrary request field.
- Keep submissions immutable as received. Store reviewer mappings, corrections, decisions, and actual applied changes separately.
- Initially approve or reject a submission as a whole after mappings and corrections. Defer selective merge controls to phase 3. Approval must respect dependencies between new hierarchy records, routes, attachments, and topos.
- New/updated route proposals and attachments do not require a topo. A topo-only submission may reference existing routes without proposing changes to them.
- Omitted fields mean unchanged; explicit `null` means clear a nullable field. Existing route references do not imply updates. Initial route operations are create, update, and reference; route deletion is outside this scope.
- **Confirmed issue scope:** only reports in `In Moderation` enter the issue review queue. Use existing statuses, approval/archival metadata, and audit history; no independent issue-review state is needed. Reports already made public by current rules remain in the existing issue workflows.

## Phase 1: submission data and APIs

### 1A. Define and document the changeset contract

Define a versioned contract in canonical submission/domain types, with:

- Submission identity, client request ID for idempotent retry, trusted source/origin, submitter or service account, submission time, and optional source references and evidence.
- Stable item IDs, existing TABVAR numeric IDs where known, client IDs for new entities, and explicit parent and attachment references.
- Explicit create/update/reference operations for routes and the hierarchy needed to place them. Support proposed crags and sectors already present in the current intake contract.
- Route patches restricted to editable canonical fields. Preserve client base values for changed fields when available, alongside a server snapshot captured at intake. Record when a client baseline is unavailable; do not fabricate it.
- Optional topo data: stable UUID, existing server ID where known, metadata, clean background, rendered raster, versioned annotations, and route links with labels and ordering.
- Optional attachments: stored object key, MIME type, original filename, size/hash, purpose, associated items, and whether the file is review evidence or should become a public attachment.
- Provenance usable by a later AI producer: source document/link, reference location or excerpt, and optional field-level evidence. This is a data contract, not an ingestion pipeline.

Matching policy: resolve explicit server IDs first. Legacy names can suggest matches within the specified crag/sector, but ambiguous matches and possible duplicate creates require reviewer mapping. A rename keeps entity identity. Never merge or overwrite a route solely because its name matches.

### 1B. Migrate storage and normalize existing submissions

Generalize `topo_submission` into `submission`, with source, schema version, pending/approved/rejected status, review metadata, and idempotency identity. Add `submission_change` and `submission_attachment` records for explicit changes, baselines, associations, and publication results. Store small typed field patches/snapshots as JSON; retain the original payload for inspection and audit. Ensure serialized payload reads preserve exact values: the current database plugin applies HTML decoding to every string, which can alter JSON content and invalidate evidence or fingerprints.

Keep approved/rejected records and the effective reviewed proposal, including actual before/after values and resulting server IDs. Ensure account deletion cannot remove publication history or shared files unintentionally; preserve actor display information while clearing account links where appropriate. Update the existing account-deletion policy and tests deliberately for these retained records.

Backfill current submissions as human/TopoBuilder. Normalize their trees and attachments without changing IDs or uploaded URLs. Mark missing identity, missing baselines, unresolved matches, and image-only legacy topos explicitly. A legacy photo must not be represented as if it contained annotations. Invalid legacy payloads remain visible with an explanation and cannot be approved until corrected.

Use Wrangler to create the next migration number, apply locally, and regenerate database types. Determine the number at implementation time; unrelated migration work already exists. Preserve existing publication tables and external API contracts.

### 1C. Implement validated, retry-safe intake

Add a shared intake service and `/api/v1/submissions` endpoint, accepting JSON without files and multipart requests with files. Keep `/api/topobuilder/submissions` as a compatibility adapter for the current client and legacy tree format. Preserve its `{ id, status }` response.

Validate the complete payload and file references before upload. Check entity IDs, parent relationships, duplicate references, supported fields, annotations, attachment types, and reasonable request/file limits. Allow route-only and attachment-only proposals with valid targets. Reject empty/no-op submissions with a useful explanation.

Deduplicate retries by authenticated submitter, origin, and client request ID. A repeated ID with different content is an error, not a silent replacement. Legacy requests without a request ID remain accepted, but cannot receive the same retry guarantee; do not infer retry identity from route names or identical content. Upload only referenced files, persist server-generated object metadata, and clean up files written by failed intake without deleting shared objects. Return validation failures as 4xx and storage/database failures as 5xx.

Add a caller-scoped status/read endpoint reporting review status, notes, and applied ID mappings so the client can distinguish queued submission from publication.

Resolve the existing direct topo-write contract explicitly. Recommended policy: external contributions use the submissions API; any retained direct-write endpoint requires a clearly authorized trusted publishing identity. Do not silently change a response that currently returns a published topo into one returning a pending submission. Update the API documentation and caller tests with the chosen transition.

### 1D. Implement comparison and publication services

Build one comparison service that resolves targets and returns new records, changed fields, unchanged references, attachments, and validation/mapping requirements. Compare the proposed patch with current published data for the review UI; preserve the submitted baseline independently for phase 3 and history.

Implement approve/reject services with reviewer notes and server-side validation. Publication applies only the effective reviewed patch, creates dependencies in order, stores ordinary attachments in the existing attachment/junction model, and stores editable topos in `topo`/`route_topo`. Reuse established validation, storage, timestamp, hierarchy, and search conventions; split existing helpers where needed to avoid repeating uploads or doing unguarded incremental writes.

Publish database changes, decision state, audit results, and ID mappings atomically using a D1-compatible prebuilt batch. Resolve new IDs through stable mapping keys/SQL references rather than expecting IDs during the buffered Kysely transaction. Guard status and reviewed data in the same operation so concurrent reviewers and repeated approval requests cannot publish twice or leave partial changes.

Handle R2 separately from the database transaction: prepare assets before committing, publish references only after assets are available, and clean up only newly created unreferenced objects after failure. Rejection retains review evidence; destructive retention cleanup is a separate policy.

Before committing, verify that the canonical values shown to the reviewer still match. Return a refresh-required result if they changed after the page was loaded. This is the minimum approval safeguard in phases 1-2; comparing competing pending submissions is deferred to phase 3.

Verify that approved data appears in public route views and existing route/topo delta sync, including search indexes and attachment/route timestamps.

### 1E. Update the TopoBuilder producer

Update `../topobuilder` submission types, builder, export bundle, upload client, and submission state together:

- Include linked TABVAR routes and their numeric IDs. Preserve local identities rather than deduplicating routes by name.
- Submit supported route metadata and explicit update patches/base values where existing-route editing is supported. Linked unchanged catalog routes remain references. Add a focused edit-proposal flow if the existing editor cannot express changes to catalog routes.
- Include existing crag/sector IDs and stable topo UUIDs, annotations, the original background, and a raster generated through the existing rendering pipeline.
- Retain synced route base values/revisions needed to identify intended changes. If storage must change, follow the companion repository's shipped-schema migration rules; do not rewrite released migrations.
- Generate one persistent request ID per submission attempt, reuse it on retry, and distinguish submitted/pending from approved/published in client state and messaging. Apply returned mappings after approval so later submissions update the same published entities.

Use the existing upload and rendering APIs; no dependency or native configuration changes are planned. Preserve the old server adapter until the upgraded client is deployed.

**Phase 1 acceptance:** a mixed submission containing new routes, route updates, existing references, and optional topos/attachments can be queued, compared, and published once. Retry, rejection, and failure leave published data consistent. Old submissions remain reviewable.

## Phase 2: rebuild the review page

### 2A. Add separate queues and a focused review layout

Rename the page and navigation to **Submissions**. Use three tabs with pending counts: **TopoBuilder**, **Issue reports**, and **AI updates**. The AI tab initially explains that no producer is connected. Do not synthesize AI records or add importer settings.

Each tab has its own appropriate filters, search, sorting, empty state, and selected item. Human/AI submissions have pending/approved/rejected status filters; the issue queue contains only `In Moderation` reports and links to the existing issue manager for other statuses and history. Persist tab/filter/selection in URL query parameters for links and refresh. Load complete modest changesets without requiring pagination or virtualization.

On desktop, use a list beside the selected submission; on narrow screens, open the selected item in a single-column detail view. List summaries show location, submitter/source, time, status, and counts of new routes, changed routes, and attachments. Distinguish source with text and an icon as well as color.

### 2B. Build the shared human/AI changeset reviewer

The detail view shows:

- Source, submission context, review history, and summary counts.
- New route cards with proposed metadata; existing route cards with explicit **Current -> Proposed** field comparisons. Collapse unchanged fields and keep unchanged linked routes distinguishable from edits.
- Added/changed crag or sector data and unresolved mapping choices when relevant.
- Attachment thumbnails/previews/downloads, topo background/raster previews, and the routes represented by each topo. Keep source evidence separate from proposed public attachments.
- Corrections and target mapping controls, with required fixes shown next to the affected item. Preserve original versus reviewer-corrected values.
- Approve/reject actions with decision notes, pending state, validation errors, refresh-required handling, and navigation to the next pending item. History displays the actual applied before/after values rather than recalculating them from today's database.

Human submissions emphasize contributor context and topo imagery. AI submissions emphasize document provenance and supporting evidence, using the same diff and approval components. Do not build AI model controls or require artificial confidence scores.

### 2C. Integrate issue reports

Query only reports whose current status is `In Moderation`. Reuse issue models, attachment components, mutation services, and audit history. Present route/location, description, taxonomy, affected bolts, safety flag, attachments, and report/status history. Every existing moderated report is eligible; no issue backfill or separate review-state table is necessary.

Offer edits, accept to `Reported`, and archive through the existing mutation services, preserving approval/archival actor metadata and audit logging. Guard each decision against stale report content/status and remove decided reports from the queue after revalidation. Reports already public or completed do not enter this queue. Repair actions such as completion remain in `/issues/manage`; include a link to that workflow and its history. Preserve current automatic publication and member workflows.

Keep `/issues/manage` available, especially for member repair workflows. Extract shared pieces rather than maintaining a second copy of its moderation logic. The existing modal posts to its current route; adapt its action target when reused.

**Phase 2 acceptance:** an admin can review and decide a complete TopoBuilder submission and an issue report from one page, understand each proposed field change, inspect attachments, and find decision history. Tabs stay separate and AI has a ready empty queue.

## Phase 3: conflict detection and resolution

Use the identities, patches, baselines, and audit data introduced in phase 1. Compare pending changes against current published data and other pending changes across human and AI sources, even though their queues remain separate.

For each changed field, compare base, current, and proposed values:

- Different fields changed on the same route: compatible if structural constraints permit both.
- Same field changed to the same value: compatible/already satisfied.
- Same field changed to different values: requires resolution.
- Canonical value changed since the supplied base: a potential conflict; preserve unrelated changes.
- Missing/deleted targets, incompatible hierarchy changes, duplicate route creation, and incompatible topo/link changes: explicit structural conflicts.

For legacy submissions with no reliable client base, label that limitation and require an explicit reviewer decision where intent cannot be established. Do not infer a historical base from current data.

Add conflict counts and a warning on the affected submission/route/field. Show **Base | Current | This proposal | Other proposal**, with links to the other submissions and their sources. Cross-source conflicts are visible without combining the queues.

Allow keeping the current value, choosing the proposal, or entering a corrected value. Allow mapping a duplicate create to an existing route and rejecting conflicting portions, respecting dependent topo and attachment links. Define an explicit partially-approved outcome with item decisions and skipped-change reasons so history and client status remain truthful.

Resolve each submission independently; do not introduce a bulk merge of submissions. Store resolution choices and reviewer rationale separately from original proposals. Recheck conflicts and reviewed revisions at approval time, atomically guard publication, and refresh affected pending submissions after a decision.

**Phase 3 acceptance:** compatible edits preserve each other, incompatible edits cannot silently overwrite one another, and every chosen resolution is visible and auditable. Humans and AI use the same correctness rules.

## Verification and delivery

Use focused Vitest tests and `app/test/helpers.ts` for intake, mapping/diffs, approvals, permissions, issue review, and route actions. Use existing SQLite integration-test conventions for migration/backfill, foreign keys, hierarchy/search/timestamp triggers, and rollback. Validate batch behavior against local D1 because the mock and standard SQLite transaction behaviors differ from the installed D1 adapter.

Meaningful regression cases include omitted versus cleared values, renamed routes, same-name routes in different sectors, shared route references across topos, linked catalog routes, route-only submissions, legacy image-only topos, ambiguous mapping, corrupt payloads, retry with changed content, failed upload/commit, concurrent/double approval, issue filtering to `In Moderation`, stale issue decisions after content/attachment edits, and preserved account-deletion history. Phase 3 adds field-level and structural conflict cases.

After each implementation slice, run `npm run verify` in tabvar using the pinned Node/npm versions. Run `npm run build` for API/UI/runtime integration changes. In TopoBuilder run typecheck and Jest; run its Playwright web checks for changed UI or web behavior. Inspect the final admin UI at desktop and narrow widths with empty, pending, error, and reviewed states.

Deliver server compatibility and backfill before the upgraded TopoBuilder client. Publish the review UI after the shared services are tested. Add conflict tools after phases 1-2 work end to end. Update the submission, topo sync, route sync, and issue sync documentation as their contracts change. Production migration/deployment is a separate approved step.
