import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  createSubmission,
  getSubmissionStatus,
  listMySubmissions,
  parseSubmissionRequest,
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
 * GET without `id` lists the caller's own submissions (whatever their role);
 * `since` limits decided ones to those since a previous serverTime.
 * GET with `id` reports on one of the caller's submissions.
 */
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  const tokenUser = await requireApiToken(request, context, headers);

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) {
    const list = await listMySubmissions(context, { uid: tokenUser.uid, since: params.get("since") });
    return jsonResponse(list, { headers });
  }

  const status = await getSubmissionStatus(context, { uid: tokenUser.uid, id });
  if (!status) {
    return apiError("not_found", 404, "Submission not found.", headers);
  }
  return jsonResponse(status, { headers });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to create a submission.", headers);
  }

  const tokenUser = await requireApiToken(request, context, headers);

  try {
    const { payload, files } = await parseSubmissionRequest(request);
    const submission = await createSubmission(context, {
      uid: tokenUser.uid,
      source: SOURCE,
      payload,
      files,
    });

    return jsonResponse(submission, { status: 201, headers });
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      return apiError("invalid_submission", 400, error.message, headers);
    }

    console.error("Error creating submission:", error);
    return apiError("server_error", 500, "Failed to store the submission.", headers);
  }
};
