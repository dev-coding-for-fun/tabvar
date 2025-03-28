import { ActionFunction, data } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import type { TopoAttachment, User } from "~/lib/models";
import { removeAttachment, uploadAttachment, addAttachmentToRoute } from "~/lib/attachment.server";
import { getAuthenticator } from "~/lib/auth.server";

interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: TopoAttachment;
}

export const action: ActionFunction = async ({ request, context }) => {
  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user || (user.role !== 'admin' && user.role !== 'member')) {
    return data({ error: 'Unauthorized' }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");
  const routeIds = formData.getAll("routeId").map(id => Number(id));

  switch (action) {
    case "upload": {
      const file = formData.get("file") as File;
      if (!file || routeIds.length === 0) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await uploadAttachment(context, file, routeIds));
    }

    case "delete": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || routeIds.length !== 1) {
        return data({ success: false, error: "Missing or invalid route ID" }, { status: 400 });
      }
      return data(await removeAttachment(context, routeIds[0], attachmentId));
    }

    case "add": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || routeIds.length === 0) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await addAttachmentToRoute(context, routeIds, attachmentId));
    }

    default:
      return data({ success: false, error: "Invalid action" }, { status: 400 });
  }
}; 