import type { AppLoadContext } from 'react-router';

export interface UploadFileResult {
  url: string;
  name: string;
  type: string;
}

export interface UploadFileOptions {
  keyPrefix?: string;
}

/**
 * Helper to resolve an R2Bucket binding from context given either a bucket name
 * (from env.ISSUES_BUCKET_NAME, env.TOPOS_BUCKET_NAME, or literal name) or direct binding name.
 */
export function getR2Bucket(context: AppLoadContext, bucketName: string): R2Bucket {
  const env = context.cloudflare.env as unknown as Env;

  if (
    bucketName === env.ISSUES_BUCKET_NAME ||
    bucketName === 'tabvar-issues-uploads' ||
    bucketName === 'tabvar-issues-uploads-dev' ||
    bucketName === 'TABVAR_ISSUES_UPLOADS' ||
    bucketName === 'issues'
  ) {
    if (env.TABVAR_ISSUES_UPLOADS) {
      return env.TABVAR_ISSUES_UPLOADS;
    }
  }

  if (
    bucketName === env.TOPOS_BUCKET_NAME ||
    bucketName === 'tabvar-topos' ||
    bucketName === 'tabvar-topos-dev' ||
    bucketName === 'TABVAR_TOPOS' ||
    bucketName === 'topos'
  ) {
    if (env.TABVAR_TOPOS) {
      return env.TABVAR_TOPOS;
    }
  }

  // Fallback to direct matching key on env
  const directBucket = (env as any)[bucketName];
  if (directBucket && typeof directBucket.put === 'function') {
    return directBucket as R2Bucket;
  }

  throw new Error(`Could not resolve R2 bucket binding for '${bucketName}'. Ensure it is configured in wrangler.toml.`);
}

/**
 * Uploads a file directly to Cloudflare R2 using the native Worker binding.
 * @param context The application load context.
 * @param file The file to upload.
 * @param bucketName The name or binding key of the R2 bucket.
 * @param bucketDomain The public domain URL of the R2 bucket.
 * @returns The uploaded file's information including public URL.
 */
export async function uploadFileToR2(
  context: AppLoadContext,
  file: File | Blob,
  bucketName: string,
  bucketDomain: string,
  options: UploadFileOptions = {},
): Promise<UploadFileResult> {
  const bucket = getR2Bucket(context, bucketName);

  // Generate a unique filename if the file object doesn't have a name, otherwise decode the provided name
  const originalName = 'name' in file ? file.name : `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const decodedFileName = decodeURIComponent(originalName); // Decode potential URL encoding

  // Determine content type, specifically handling GPX files
  let contentType = file.type || 'application/octet-stream';
  if (decodedFileName.toLowerCase().endsWith('.gpx')) {
    contentType = 'application/gpx+xml';
  }

  const normalizedPrefix = options.keyPrefix
    ?.split('/')
    .filter(Boolean)
    .join('/');
  const objectKey = normalizedPrefix ? `${normalizedPrefix}/${decodedFileName}` : decodedFileName;

  const arrayBuffer = await file.arrayBuffer();
  await bucket.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType,
    },
  });

  // Encode each path segment while preserving any object-key prefixes.
  const encodedObjectKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const fileUrl = `${bucketDomain}/${encodedObjectKey}`;

  return {
    url: fileUrl, // Use the encoded URL
    name: objectKey,
    type: contentType,
  };
}

/**
 * Deletes an object from Cloudflare R2 using the native Worker binding.
 * @param context The application load context.
 * @param bucketName The name or binding key of the R2 bucket.
 * @param fileName The key of the object to delete.
 */
export async function deleteFromR2(context: AppLoadContext, bucketName: string, fileName: string): Promise<void> {
  const bucket = getR2Bucket(context, bucketName);
  await bucket.delete(fileName);
}

/**
 * Renames an object in Cloudflare R2 by getting it, putting with the new key, and deleting the old key.
 * @param context The application load context.
 * @param bucketName The name or binding key of the R2 bucket.
 * @param oldKey The current key (filename) of the object.
 * @param newKey The desired new key (filename) for the object.
 */
export async function renameInR2(context: AppLoadContext, bucketName: string, oldKey: string, newKey: string): Promise<void> {
  const bucket = getR2Bucket(context, bucketName);
  const existingObject = await bucket.get(oldKey);
  if (!existingObject) {
    throw new Error(`Object '${oldKey}' not found in R2 bucket '${bucketName}'.`);
  }

  await bucket.put(newKey, existingObject.body, {
    httpMetadata: existingObject.httpMetadata,
    customMetadata: existingObject.customMetadata,
  });

  await bucket.delete(oldKey);
}