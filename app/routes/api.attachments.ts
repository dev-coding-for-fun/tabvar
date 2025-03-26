import { ActionFunction, data } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import type { TopoAttachment } from "~/lib/models";
import { removeAttachment, uploadAttachment, addAttachmentToRoute } from "~/lib/attachment.server";

interface AttachmentUploadResult {
  success: boolean;
  error?: string;
  attachment?: TopoAttachment;
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
      return data(await uploadAttachment(context, file, routeId));
    }

    case "delete": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || !routeId) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await removeAttachment(context, routeId, attachmentId));
    }

    case "add": {
      const attachmentId = Number(formData.get("attachmentId"));
      if (!attachmentId || !routeId) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      return data(await addAttachmentToRoute(context, routeId, attachmentId));
    }

    default:
      return data({ success: false, error: "Invalid action" }, { status: 400 });
  }
}; 