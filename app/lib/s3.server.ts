import { AppLoadContext } from '@remix-run/cloudflare';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
  file: File,
  bucketName: string,
  keyPrefix: string = 'uploads/'
): Promise<UploadFileResult> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const client = getS3Client(context);

  const params = {
    Bucket: bucketName,
    Key: file.name,
    Body: buffer,
    ContentType: file.type,
  };

  const command = new PutObjectCommand(params);
  await client.send(command);

  return {
    url: `/${bucketName}/${keyPrefix}${file.name}`,
    name: file.name,
    type: file.type,
  };
}