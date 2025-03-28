import { AppLoadContext } from '@remix-run/cloudflare';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
 * @param keyPrefix A prefix for the file key (e.g., folder path).
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

  // Generate a unique filename if the file object doesn't have a name
  const fileName = 'name' in file ? file.name : `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const contentType = file.type || 'application/octet-stream';

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(params);
  await client.send(command);

  const fileUrl = `${bucketDomain}/${fileName}`;

  return {
    url: fileUrl,
    name: fileName,
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