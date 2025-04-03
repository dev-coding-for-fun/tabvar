import { getDB } from "./db";
import type { AppLoadContext } from "@remix-run/cloudflare";
import { uploadFileToR2, deleteFromR2 } from "./s3.server";
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

    // Check if attachment is referenced by other entities
    const [routeRefs, sectorRefs, cragRefs] = await Promise.all([
      db.selectFrom('route_attachment')
        .where('attachment_id', '=', attachmentId)
        .where('route_id', '!=', routeId)
        .select(['route_id'])
        .execute(),
      db.selectFrom('sector_attachment')
        .where('attachment_id', '=', attachmentId)
        .select(['sector_id'])
        .execute(),
      db.selectFrom('crag_attachment')
        .where('attachment_id', '=', attachmentId)
        .select(['crag_id'])
        .execute()
    ]);

    // Only delete the attachment record and file if it's not referenced elsewhere
    if (routeRefs.length === 0 && sectorRefs.length === 0 && cragRefs.length === 0) {
      const attachment = await db
        .selectFrom('topo_attachment')
        .where('id', '=', attachmentId)
        .select(['url', 'name'])
        .executeTakeFirstOrThrow();

      const env = context.cloudflare.env as unknown as Env;
      const fileName = attachment.name ?? attachment.url.split('/').pop();
      if (!fileName) { throw new Error('Invalid attachment filename'); }

      await deleteFromR2(context, env.TOPOS_BUCKET_NAME, fileName);

      // Delete the attachment record
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




