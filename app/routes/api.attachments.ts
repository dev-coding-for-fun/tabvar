import { ActionFunction, data } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import { getDB } from "~/lib/db";
import { deleteFromR2, uploadFileToR2 } from "~/lib/s3.server";
import type { TopoAttachment } from "~/lib/models";

interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: TopoAttachment;
}

async function handleUpload(
  context: AppLoadContext,
  file: File,
  routeId: number
): Promise<AttachmentUploadResult> {
  const env = context.cloudflare.env as unknown as Env;
  try {
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

async function handleDelete(
  context: AppLoadContext,
  routeId: number,
  attachmentId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    
    const attachment = await db
      .selectFrom('topo_attachment')
      .where('id', '=', attachmentId)
      .select(['url', 'name'])
      .executeTakeFirstOrThrow();

    // Delete the route attachment association
    await db
      .deleteFrom('route_attachment')
      .where('route_id', '=', routeId)
      .where('attachment_id', '=', attachmentId)
      .execute();
    
    // Delete the attachment record
    await db
      .deleteFrom('topo_attachment')
      .where('id', '=', attachmentId)
      .execute();

    const env = context.cloudflare.env as unknown as Env;
    const fileName = attachment.name ?? attachment.url.split('/').pop();
    if (!fileName) { throw new Error('Invalid attachment filename'); }
    await deleteFromR2(context, env.TOPOS_BUCKET_NAME, fileName);

    return { success: true };
  } catch (error) {
    console.error('Error deleting attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete attachment'
    };
  }
}

export const action: ActionFunction = async ({ request, context }) => {
  const formData = await request.formData();
  const action = formData.get("_action");
  const routeId = Number(formData.get("routeId"));

  switch (action) {
    case "upload": {
      const file = formData.get("file") as File;
      if (!file || !routeId) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await handleUpload(context, file, routeId));
    }

    case "delete": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || !routeId) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await handleDelete(context, routeId, attachmentId));
    }

    default:
      return data({ success: false, error: "Invalid action" }, { status: 400 });
  }
}; 