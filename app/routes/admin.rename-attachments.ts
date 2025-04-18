import { LoaderFunctionArgs, json } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import { getAuthenticator } from "~/lib/auth.server";
import { getAllAttachments, updateAttachmentRecord } from "~/lib/attachment.server";
import { renameInR2 } from "~/lib/s3.server";

interface RenameResult {
  processed: number;
  renamed: number;
  errors: { id: number; name: string | null; error: string }[];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user || user.role !== 'admin') {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  const env = context.cloudflare.env as unknown as Env;
  const bucketName = env.TOPOS_BUCKET_NAME;
  const bucketDomain = env.TOPOS_BUCKET_DOMAIN;

  if (!bucketName || !bucketDomain) {
    return json({ error: 'R2 bucket configuration missing in environment variables.' }, { status: 500 });
  }

  const results: RenameResult = {
    processed: 0,
    renamed: 0,
    errors: [],
  };

  try {
    const attachments = await getAllAttachments(context);
    results.processed = attachments.length;

    for (const attachment of attachments) {
      if (!attachment.name) {
        // Skip attachments without a name (shouldn't happen with current logic, but good to check)
        continue;
      }

      try {
        const decodedName = decodeURIComponent(attachment.name);

        if (decodedName !== attachment.name) {
          // Name contains URL encoding, needs renaming
          console.log(`Renaming attachment ID ${attachment.id}: '${attachment.name}' -> '${decodedName}'`);

          // 1. Rename in R2
          await renameInR2(context, bucketName, attachment.name, decodedName);

          // 2. Construct new URL (ensure new name is encoded for URL)
          const newUrl = `${bucketDomain}/${encodeURIComponent(decodedName)}`;

          // 3. Update database record
          await updateAttachmentRecord(context, attachment.id, decodedName, newUrl);

          results.renamed++;
        }
      } catch (error: any) {
        console.error(`Failed to rename attachment ID ${attachment.id} ('${attachment.name}'):`, error);
        results.errors.push({
          id: attachment.id,
          name: attachment.name,
          error: error.message || "Unknown error during renaming",
        });
      }
    }

    return json(results);
  } catch (error: any) {
    console.error("Error fetching or processing attachments:", error);
    return json({ error: 'Failed to process attachments', details: error.message }, { status: 500 });
  }
} 