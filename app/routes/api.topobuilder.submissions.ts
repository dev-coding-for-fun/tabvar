import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  listMyObjects,
  parseSubmissionRequest,
  receiveObjects,
  SubmissionValidationError,
} from "~/lib/submission.server";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiToken,
} from "~/lib/topobuilderAuth.server";

const SOURCE = "topobuilder";

/**
 * Lists the caller's own objects (whatever their role) with their review state;
 * `since` limits it to objects changed since a previous serverTime.
 */
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  const tokenUser = await requireApiToken(request, context, headers);

  const since = new URL(request.url).searchParams.get("since");
  return jsonResponse(await listMyObjects(context, { uid: tokenUser.uid, since }), { headers });
};

/** Proposes or withdraws objects. Sending the same objects again is safe. */
export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to submit objects.", headers);
  }

  const tokenUser = await requireApiToken(request, context, headers);

  try {
    const { payload, files } = await parseSubmissionRequest(request);
    const objects = await receiveObjects(context, {
      uid: tokenUser.uid,
      source: SOURCE,
      payload,
      files,
    });
    return jsonResponse({ objects }, { headers });
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      return apiError("invalid_submission", 400, error.message, headers);
    }

    console.error("Error receiving submission:", error);
    return apiError("server_error", 500, "Failed to store the submission.", headers);
  }
};
