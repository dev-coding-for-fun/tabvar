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
  routeId: number
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

    await db
      .insertInto('route_attachment')
      .values({
        route_id: routeId,
        attachment_id: attachment.id
      })
      .execute();

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
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    
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

    // Delete the route attachment association
    await db
      .deleteFrom('route_attachment')
      .where('route_id', '=', routeId)
      .where('attachment_id', '=', attachmentId)
      .execute();

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
  routeId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    
    // Check if the attachment already exists for this route
    const existing = await db
      .selectFrom('route_attachment')
      .where('route_id', '=', routeId)
      .where('attachment_id', '=', attachmentId)
      .select(['route_id'])
      .executeTakeFirst();

    if (existing) {
      return { success: true }; // Already exists, no need to add it again
    }

    // Add the route attachment association
    await db
      .insertInto('route_attachment')
      .values({
        route_id: routeId,
        attachment_id: attachmentId
      })
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