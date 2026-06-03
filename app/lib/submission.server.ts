import type { AppLoadContext } from "react-router";
import { IMAGE_TYPES } from "./constants";
import { getDB } from "./db";
import { uploadFileToR2 } from "./s3.server";

const SUBMISSION_CLIENT = "topobuilder";
const SUBMISSION_STATUS_PENDING = "pending";

type SubmissionKind = "crag" | "sector" | "topo";
type TargetLevel = "crag" | "sector" | "route" | "unknown";

type SubmittedTopo = {
  fileKey?: string;
  routeRefs?: unknown;
  routes?: unknown;
  targetLevel?: TargetLevel;
  attachment?: {
    url: string;
    name: string;
    originalName: string;
    type: string;
  };
  [key: string]: unknown;
};

type SubmittedTree = {
  kind?: string;
  crag?: unknown;
  sector?: unknown;
  topo?: SubmittedTopo;
  sectors?: unknown;
  routes?: unknown;
  topos?: unknown;
  [key: string]: unknown;
};

type ParsedSubmittedTree = SubmittedTree & {
  kind: SubmissionKind;
};

export class SubmissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionValidationError";
  }
}

function isAllowedKind(value: string | undefined): value is SubmissionKind {
  return value === "crag" || value === "sector" || value === "topo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function countRoutes(topo: SubmittedTopo) {
  if (Array.isArray(topo.routeRefs)) return topo.routeRefs.length;
  if (Array.isArray(topo.routes)) return topo.routes.length;
  return 0;
}

function targetLevelForTopo(topo: SubmittedTopo, fallbackLevel: TargetLevel): TargetLevel {
  const routeCount = countRoutes(topo);
  if (routeCount > 1) return "sector";
  if (routeCount === 1) return "route";
  return fallbackLevel;
}

function getTopos(container: Record<string, unknown>): SubmittedTopo[] {
  const topos = asRecordArray(container.topos) as SubmittedTopo[];
  if (isRecord(container.topo)) {
    topos.push(container.topo as SubmittedTopo);
  }
  return topos;
}

function annotateTopoTargets(payload: SubmittedTree) {
  getTopos(payload).forEach((topo) => {
    topo.targetLevel = targetLevelForTopo(topo, payload.kind === "crag" ? "crag" : "sector");
  });

  asRecordArray(payload.sectors).forEach((sector) => {
    getTopos(sector).forEach((topo) => {
      topo.targetLevel = targetLevelForTopo(topo, "sector");
    });
  });
}

function collectTopos(payload: SubmittedTree): SubmittedTopo[] {
  const topos = getTopos(payload);

  asRecordArray(payload.sectors).forEach((sector) => {
    topos.push(...getTopos(sector));
  });

  return topos;
}

function hasSubmittedContent(payload: SubmittedTree) {
  return Boolean(
    payload.crag ||
    payload.sector ||
    payload.topo ||
    asRecordArray(payload.sectors).length ||
    asRecordArray(payload.routes).length ||
    asRecordArray(payload.topos).length,
  );
}

function parseSubmission(formData: FormData): ParsedSubmittedTree {
  const rawSubmission = formData.get("submission");
  if (typeof rawSubmission !== "string") {
    throw new SubmissionValidationError("submission JSON field is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSubmission);
  } catch {
    throw new SubmissionValidationError("submission must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new SubmissionValidationError("submission must be a JSON object.");
  }

  const payload = parsed as SubmittedTree;
  if (!isAllowedKind(payload.kind)) {
    throw new SubmissionValidationError("submission.kind must be crag, sector, or topo.");
  }

  if (!hasSubmittedContent(payload)) {
    throw new SubmissionValidationError("submission must include at least one crag, sector, route, or topo.");
  }

  return payload as ParsedSubmittedTree;
}

function collectFiles(formData: FormData) {
  const filesByKey = new Map<string, File>();

  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      filesByKey.set(key, value);
    }
  }

  return filesByKey;
}

function originalFileName(file: File) {
  return decodeURIComponent(file.name);
}

export async function createTopoSubmission(
  context: AppLoadContext,
  { uid, formData }: { uid: string; formData: FormData },
) {
  const payload = parseSubmission(formData);
  const topos = collectTopos(payload);
  const filesByKey = collectFiles(formData);

  if (topos.length === 0) {
    throw new SubmissionValidationError("submission must include at least one topo.");
  }

  const submissionId = crypto.randomUUID();
  const env = context.cloudflare.env as unknown as Env;
  const uploadedFiles = new Map<string, Awaited<ReturnType<typeof uploadFileToR2>> & { originalName: string }>();

  for (const topo of topos) {
    if (typeof topo.fileKey !== "string" || topo.fileKey.length === 0) {
      throw new SubmissionValidationError("each topo must include a fileKey.");
    }

    const file = filesByKey.get(topo.fileKey);
    if (!file) {
      throw new SubmissionValidationError(`missing uploaded file for topo fileKey "${topo.fileKey}".`);
    }

    if (!IMAGE_TYPES.includes(file.type)) {
      throw new SubmissionValidationError(`unsupported topo file type "${file.type || "unknown"}".`);
    }

    let uploaded = uploadedFiles.get(topo.fileKey);
    if (!uploaded) {
      const uploadResult = await uploadFileToR2(
        context,
        file,
        env.TOPOS_BUCKET_NAME,
        env.TOPOS_BUCKET_DOMAIN,
        { keyPrefix: `submissions/${submissionId}` },
      );
      uploaded = {
        ...uploadResult,
        originalName: originalFileName(file),
      };
      uploadedFiles.set(topo.fileKey, uploaded);
    }

    topo.attachment = {
      url: uploaded.url,
      name: uploaded.name,
      originalName: uploaded.originalName,
      type: uploaded.type,
    };
  }

  annotateTopoTargets(payload);

  const db = getDB(context);
  await db.insertInto("topo_submission")
    .values({
      id: submissionId,
      uid,
      client: SUBMISSION_CLIENT,
      status: SUBMISSION_STATUS_PENDING,
      kind: payload.kind,
      payload: JSON.stringify(payload),
    })
    .execute();

  return {
    id: submissionId,
    status: SUBMISSION_STATUS_PENDING,
  };
}
