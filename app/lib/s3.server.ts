import { AppLoadContext } from '@remix-run/cloudflare';
import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';

function getS3Client(context: AppLoadContext): S3Client {
  const env = context.cloudflare.env as unknown as Env;

  return new S3Client({
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    region: 'auto',
    endpoint: env.R2_ENDPOINT_URL,
    forcePathStyle: true, // Needed for minio client to connect to Cloudflare
  });
}

interface UploadFileResult {
  url: string;
  name: string;
  type: string;
}

async function getFileBuffer(file: File | Blob): Promise<Buffer> {
  // Both File and Blob objects have arrayBuffer method
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Uploads a file to Cloudflare R2.
 * @param context The application load context.
 * @param file The file to upload.
 * @param bucketName The name of the R2 bucket.
 * @param bucketDomain The domain of the R2 bucket.
 * @returns The uploaded file's information including URL.
 */
export async function uploadFileToR2(
  context: AppLoadContext,
  file: File | Blob,
  bucketName: string,
  bucketDomain: string,
): Promise<UploadFileResult> {
  const buffer = await getFileBuffer(file);
  const client = getS3Client(context);

  // Generate a unique filename if the file object doesn't have a name, otherwise decode the provided name
  const originalName = 'name' in file ? file.name : `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const decodedFileName = decodeURIComponent(originalName); // Decode potential URL encoding
  const contentType = file.type || 'application/octet-stream';

  const params = {
    Bucket: bucketName,
    Key: decodedFileName, // Use the decoded filename as the key
    Body: buffer,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(params);
  await client.send(command);

  // Encode the filename component for the URL to match R2's storage
  const encodedFileName = encodeURIComponent(decodedFileName);
  const fileUrl = `${bucketDomain}/${encodedFileName}`;

  return {
    url: fileUrl, // Use the encoded URL
    name: decodedFileName, // Return the clean, decoded filename
    type: contentType,
  };
}

export async function deleteFromR2(context: AppLoadContext, bucketName: string, fileName: string) {
  const client = getS3Client(context);
  const params = {
    Bucket: bucketName,
    Key: fileName,
  };
  await client.send(new DeleteObjectCommand(params));
}

/**
 * Renames an object in Cloudflare R2 by copying it to a new key and deleting the old one.
 * @param context The application load context.
 * @param bucketName The name of the R2 bucket.
 * @param oldKey The current key (filename) of the object.
 * @param newKey The desired new key (filename) for the object.
 */
export async function renameInR2(context: AppLoadContext, bucketName: string, oldKey: string, newKey: string): Promise<void> {
  const client = getS3Client(context);

  // Copy the object to the new key
  const copyParams = {
    Bucket: bucketName,
    CopySource: `${bucketName}/${encodeURIComponent(oldKey)}`, // Source must be URL encoded
    Key: newKey,
  };
  await client.send(new CopyObjectCommand(copyParams));

  // Delete the old object
  const deleteParams = {
    Bucket: bucketName,
    Key: oldKey,
  };
  await client.send(new DeleteObjectCommand(deleteParams));
}