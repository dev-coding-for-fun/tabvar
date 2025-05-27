import { ActionFunction, data } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import type { TopoAttachment, User } from "~/lib/models";
import { removeAttachment, uploadAttachment, addAttachmentToRoute, addAttachmentToSector, addAttachmentToCrag } from "~/lib/attachment.server";
import { requireUser } from "~/lib/auth.server";

interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: TopoAttachment;
}

export const action: ActionFunction = async ({ request, context }) => {
  const user = await requireUser(request, context);
  if (user.role !== 'admin' && user.role !== 'super' && user.role !== 'member') {
    return data({ error: 'Unauthorized' }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");
  const routeIds = formData.getAll("routeId").map(id => Number(id));
  const sectorId = Number(formData.get("sectorId"));
  const cragId = Number(formData.get("cragId"));

  switch (action) {
    case "upload": {
      const file = formData.get("file") as File;
      if (!file || (routeIds.length === 0 && sectorId === 0 && cragId === 0)) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await uploadAttachment(context, file, routeIds, sectorId, cragId));
    }

    case "delete": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || (routeIds.length !== 1 && sectorId === 0 && cragId === 0)) {
        return data({ success: false, error: "Missing or invalid route ID" }, { status: 400 });
      }
      return data(await removeAttachment(context, routeIds[0], sectorId, cragId, attachmentId));
    }

    case "add": {
      const attachmentId = Number(formData.get("attachmentId"));
      const routeIds = formData.getAll("routeId").map(id => Number(id));
      const sectorId = Number(formData.get("sectorId")) || 0;
      const cragId = Number(formData.get("cragId")) || 0;

      if (!attachmentId || (routeIds.length === 0 && sectorId === 0 && cragId === 0)) {
        return data({ success: false, error: "Missing required fields for add" }, { status: 400 });
      }

      if (routeIds.length > 0) {
        return data(await addAttachmentToRoute(context, routeIds, attachmentId));
      } 
      if (sectorId > 0) {
        return data(await addAttachmentToSector(context, sectorId, attachmentId));
      } 
      if (cragId > 0) {
        return data(await addAttachmentToCrag(context, cragId, attachmentId));
      }

      return data({ success: false, error: "Invalid attachment target" }, { status: 400 });
    }

    default:
      return data({ success: false, error: "Invalid action" }, { status: 400 });
  }
}; 