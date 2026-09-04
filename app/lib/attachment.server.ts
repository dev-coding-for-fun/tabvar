import { getDB } from "./db";
import type { AppLoadContext } from "react-router";
import { uploadFileToR2, deleteFromR2, getR2Bucket, calculateFileHash } from "./s3.server";
import { TopoAttachment } from "./models";

export interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: TopoAttachment;
}

export async function uploadAttachment(
  context: AppLoadContext,
  file: File,
  routeIds: number[],
  sectorId: number,
  cragId: number
): Promise<AttachmentUploadResult> {
  try {
    const env = context.cloudflare.env as unknown as Env;
    const uploadResult = await uploadFileToR2(context, file, env.TOPOS_BUCKET_NAME, env.TOPOS_BUCKET_DOMAIN);
    const db = getDB(context);

    // Create the attachment record
    const attachment = await db
      .insertInto('topo_attachment')
      .values({
        url: uploadResult.url,
        type: uploadResult.type,
        name: uploadResult.name
      })
      .returning(['id', 'url', 'type', 'name'])
      .executeTakeFirstOrThrow() as TopoAttachment;

    if (routeIds.length > 0) {
      await db
        .insertInto('route_attachment')
        .values(
          routeIds.map(routeId => ({
            route_id: routeId,
            attachment_id: attachment.id
          }))
        )
        .execute();
    }
    else if (sectorId > 0) {
      await db
        .insertInto('sector_attachment')
        .values({
          sector_id: sectorId,
          attachment_id: attachment.id
        })
        .execute();
    }
    else if (cragId > 0) {
      await db
        .insertInto('crag_attachment')
        .values({
          crag_id: cragId,
          attachment_id: attachment.id
        })
        .execute();
    }
    return {
      success: true,
      attachment
    };
  } catch (error) {
    console.error('Error uploading attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload attachment'
    };
  }
}

export async function removeAttachment(
  context: AppLoadContext,
  routeId: number,
  sectorId: number,
  cragId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);

    if (routeId > 0) {
      await db
        .deleteFrom('route_attachment')
        .where('route_id', '=', routeId)
        .where('attachment_id', '=', attachmentId)
        .execute();
    }
    else if (sectorId > 0) {
      await db
        .deleteFrom('sector_attachment')
        .where('sector_id', '=', sectorId)
        .where('attachment_id', '=', attachmentId)
        .execute();
    }
    else if (cragId > 0) {
      await db
        .deleteFrom('crag_attachment')
        .where('crag_id', '=', cragId)
        .where('attachment_id', '=', attachmentId)
        .execute();
    }

    // Check if attachment is referenced by any other entities
    const remainingRefs = await db
      .selectFrom('route_attachment')
      .where('attachment_id', '=', attachmentId)
      .select('attachment_id')
      .union(
        db.selectFrom('sector_attachment')
          .where('attachment_id', '=', attachmentId)
          .select('attachment_id')
      )
      .union(
        db.selectFrom('crag_attachment')
          .where('attachment_id', '=', attachmentId)
          .select('attachment_id')
      )
      .execute();

    // Only delete the attachment record and file if it's not referenced anywhere
    if (remainingRefs.length === 0) {
      const attachment = await db
        .selectFrom('topo_attachment')
        .where('id', '=', attachmentId)
        .select(['url', 'name'])
        .executeTakeFirstOrThrow();

      // Check if any other topo_attachment records use the same URL
      const anotherAttachmentWithSameUrl = await db
        .selectFrom('topo_attachment')
        .where('url', '=', attachment.url)
        .where('id', '!=', attachmentId) // Exclude the current one
        .select('id')
        .limit(1) // Optimization: We only need to know if at least one exists
        .executeTakeFirst();

      // Only delete the file from R2 if no other attachments use this URL
      if (!anotherAttachmentWithSameUrl) {
        const env = context.cloudflare.env as unknown as Env;
        const fileName = attachment.name ?? attachment.url.split('/').pop();
        if (!fileName) { throw new Error('Invalid attachment filename'); }

        await deleteFromR2(context, env.TOPOS_BUCKET_NAME, fileName);
      }

      // Delete the attachment record itself
      await db
        .deleteFrom('topo_attachment')
        .where('id', '=', attachmentId)
        .execute();
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove attachment'
    };
  }
}

export async function addAttachmentToRoute(
  context: AppLoadContext,
  routeIds: number[],
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);

    // Get existing route attachments for this attachment
    const existing = await db
      .selectFrom('route_attachment')
      .where('attachment_id', '=', attachmentId)
      .select(['route_id'])
      .execute();

    const existingRouteIds = new Set(existing.map(e => e.route_id));

    // Filter out route IDs that already have this attachment
    const newRouteIds = routeIds.filter(id => !existingRouteIds.has(id));

    if (newRouteIds.length === 0) {
      return { success: true }; // All routes already have this attachment
    }

    // Add the route attachment associations for new routes
    await db
      .insertInto('route_attachment')
      .values(
        newRouteIds.map(routeId => ({
          route_id: routeId,
          attachment_id: attachmentId
        }))
      )
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Error adding attachment to route:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add attachment to route'
    };
  }
}

export async function addAttachmentToSector(
  context: AppLoadContext,
  sectorId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);

    const existing = await db
      .selectFrom('sector_attachment')
      .where('attachment_id', '=', attachmentId)
      .select(['sector_id'])
      .execute();
      
    const existingSectorIds = new Set(existing.map(e => e.sector_id));

    if (existingSectorIds.has(sectorId)) {
      return { success: true }; // Already has this attachment
    }
    
    await db
      .insertInto('sector_attachment')
      .values({
        sector_id: sectorId,
        attachment_id: attachmentId
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Error adding attachment to sector:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add attachment to sector' };
  }
}

export async function addAttachmentToCrag(
  context: AppLoadContext,
  cragId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);

    const existing = await db
      .selectFrom('crag_attachment')
      .where('attachment_id', '=', attachmentId)
      .select(['crag_id'])
      .execute();

    const existingCragIds = new Set(existing.map(e => e.crag_id));

    if (existingCragIds.has(cragId)) {
      return { success: true }; // Already has this attachment
    }

    await db
      .insertInto('crag_attachment')
      .values({
        crag_id: cragId,
        attachment_id: attachmentId
      })
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Error adding attachment to crag:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add attachment to crag' };
  }
}


export async function getAllAttachments(context: AppLoadContext): Promise<{ id: number; name: string | null; url: string }[]> {
  const db = getDB(context);
  return db
    .selectFrom("topo_attachment")
    .select(["id", "name", "url"]) // Select only needed fields
    .execute();
}


export async function updateAttachmentRecord(
  context: AppLoadContext,
  id: number,
  newName: string,
  newUrl: string
): Promise<void> {
  const db = getDB(context);
  await db
    .updateTable("topo_attachment")
    .set({
      name: newName,
      url: newUrl,
    })
    .where("id", "=", id)
    .execute();
}

export interface HashRecalculateStats {
  issues: {
    total: number;
    updated: number;
    skipped: number;
    duplicates: number;
    errors: number;
  };
  topos: {
    total: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  duplicates: {
    issueId: number;
    hash: string;
    attachmentIds: number[];
  }[];
  errors: {
    table: string;
    id: number;
    name: string | null;
    error: string;
  }[];
}

async function getR2ObjectWithFallbacks(bucket: R2Bucket, name: string | null, url: string) {
  const candidates: string[] = [];
  if (name) {
    candidates.push(name);
    try {
      const decoded = decodeURIComponent(name);
      if (decoded !== name) candidates.push(decoded);
    } catch {}
  }
  try {
    const urlPath = new URL(url).pathname.replace(/^\//, '');
    if (urlPath && !candidates.includes(urlPath)) {
      candidates.push(urlPath);
      const decodedPath = decodeURIComponent(urlPath);
      if (decodedPath !== urlPath && !candidates.includes(decodedPath)) {
        candidates.push(decodedPath);
      }
    }
  } catch {
    const lastSegment = url.split('/').pop();
    if (lastSegment && !candidates.includes(lastSegment)) {
      candidates.push(lastSegment);
    }
  }

  for (const key of candidates) {
    try {
      const obj = await bucket.get(key);
      if (obj) return obj;
    } catch {}
  }
  return null;
}

/**
 * Iterates over all issue_attachment and topo_attachment records in D1,
 * fetches the corresponding object from R2, computes the SHA-1 hash and file size,
 * and updates the database records. Also detects any pre-existing duplicate attachments
 * on the same issue.
 */
export async function recalculateAttachmentHashes(context: AppLoadContext): Promise<HashRecalculateStats> {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;

  const stats: HashRecalculateStats = {
    issues: { total: 0, updated: 0, skipped: 0, duplicates: 0, errors: 0 },
    topos: { total: 0, updated: 0, skipped: 0, errors: 0 },
    duplicates: [],
    errors: [],
  };

  // 1. Process issue_attachment records
  const issuesBucket = getR2Bucket(context, env.ISSUES_BUCKET_NAME);
  const issueAttachments = await db
    .selectFrom("issue_attachment")
    .select(["id", "issue_id", "name", "url", "file_hash", "file_size"])
    .execute();

  stats.issues.total = issueAttachments.length;
  const issueHashMap = new Map<string, number[]>(); // `${issue_id}:${hash}` -> attachmentIds

  for (const attachment of issueAttachments) {
    try {
      const r2Obj = await getR2ObjectWithFallbacks(issuesBucket, attachment.name, attachment.url);
      if (!r2Obj) {
        stats.issues.errors++;
        stats.errors.push({
          table: "issue_attachment",
          id: attachment.id,
          name: attachment.name,
          error: `Object not found in R2 bucket '${env.ISSUES_BUCKET_NAME}'`,
        });
        continue;
      }

      const buffer = await r2Obj.arrayBuffer();
      const hash = await calculateFileHash(buffer);
      const size = r2Obj.size ?? buffer.byteLength;

      await db
        .updateTable("issue_attachment")
        .set({ file_hash: hash, file_size: size })
        .where("id", "=", attachment.id)
        .execute();

      stats.issues.updated++;

      const key = `${attachment.issue_id}:${hash}`;
      const existing = issueHashMap.get(key) ?? [];
      existing.push(attachment.id);
      issueHashMap.set(key, existing);
    } catch (error) {
      stats.issues.errors++;
      stats.errors.push({
        table: "issue_attachment",
        id: attachment.id,
        name: attachment.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Find duplicates within same issue
  for (const [key, ids] of issueHashMap.entries()) {
    if (ids.length > 1) {
      const [issueIdStr, hash] = key.split(':');
      stats.issues.duplicates += ids.length - 1;
      stats.duplicates.push({
        issueId: Number(issueIdStr),
        hash,
        attachmentIds: ids,
      });
    }
  }

  // 2. Process topo_attachment records
  const toposBucket = getR2Bucket(context, env.TOPOS_BUCKET_NAME);
  const topoAttachments = await db
    .selectFrom("topo_attachment")
    .select(["id", "name", "url", "file_hash", "file_size"])
    .execute();

  stats.topos.total = topoAttachments.length;

  for (const attachment of topoAttachments) {
    try {
      const r2Obj = await getR2ObjectWithFallbacks(toposBucket, attachment.name, attachment.url);
      if (!r2Obj) {
        stats.topos.errors++;
        stats.errors.push({
          table: "topo_attachment",
          id: attachment.id,
          name: attachment.name,
          error: `Object not found in R2 bucket '${env.TOPOS_BUCKET_NAME}'`,
        });
        continue;
      }

      const buffer = await r2Obj.arrayBuffer();
      const hash = await calculateFileHash(buffer);
      const size = r2Obj.size ?? buffer.byteLength;

      await db
        .updateTable("topo_attachment")
        .set({ file_hash: hash, file_size: size })
        .where("id", "=", attachment.id)
        .execute();

      stats.topos.updated++;
    } catch (error) {
      stats.topos.errors++;
      stats.errors.push({
        table: "topo_attachment",
        id: attachment.id,
        name: attachment.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return stats;
}




