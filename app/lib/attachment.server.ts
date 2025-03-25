import { getDB } from "./db";
import type { AppLoadContext } from "@remix-run/cloudflare";

export interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: {
    id: number;
    url: string;
    type: string;
    name: string | null;
  };
}

export async function uploadAttachment(
  context: AppLoadContext,
  file: File,
  routeId: number
): Promise<AttachmentUploadResult> {
  try {
    // TODO: Implement file upload to R2
    // For now, we'll just create the database records
    const db = getDB(context);
    
    // Create the attachment record
    const [attachment] = await db
      .insertInto('topo_attachment')
      .values({
        url: 'placeholder-url', // TODO: Replace with actual R2 URL
        type: file.type,
        name: file.name
      })
      .returning(['id', 'url', 'type', 'name'])
      .execute();

    // Create the route attachment association
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

export async function deleteAttachment(
  context: AppLoadContext,
  routeId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    
    // Delete the route attachment association
    await db
      .deleteFrom('route_attachment')
      .where('route_id', '=', routeId)
      .where('attachment_id', '=', attachmentId)
      .execute();

    // TODO: Delete the file from R2 storage
    
    // Delete the attachment record
    await db
      .deleteFrom('topo_attachment')
      .where('id', '=', attachmentId)
      .execute();

    return { success: true };
  } catch (error) {
    console.error('Error deleting attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete attachment'
    };
  }
} 