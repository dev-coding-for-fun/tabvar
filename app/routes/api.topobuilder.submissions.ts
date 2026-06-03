import type { ActionFunctionArgs } from "react-router";
import { createTopoSubmission, SubmissionValidationError } from "~/lib/submission.server";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiToken,
} from "~/lib/topobuilderAuth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to create a topo submission.", headers);
  }

  const tokenUser = await requireApiToken(request, context, headers);

  try {
    const formData = await request.formData();
    const submission = await createTopoSubmission(context, {
      uid: tokenUser.uid,
      formData,
    });

    return jsonResponse(submission, { status: 201, headers });
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      return apiError("invalid_submission", 400, error.message, headers);
    }

    console.error("Error creating topo submission:", error);
    return apiError("invalid_submission", 400, "Failed to create topo submission.", headers);
  }
};
