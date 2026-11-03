import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';

/** Seconds a presigned URL stays valid. Downloads are short so a leaked link dies quickly. */
const UPLOAD_TTL = 15 * 60;
const DOWNLOAD_TTL = 60;
const PREVIEW_TTL = 10 * 60;

/**
 * Private object storage behind presigned URLs: the browser uploads and downloads directly, but
 * only with a URL the API signed after checking the user's permissions. Works with Cloudflare R2
 * in production and any S3-compatible server locally.
 */
export interface Storage {
  presignUpload(key: string, contentType: string, sizeBytes: number): Promise<string>;
  presignDownload(
    key: string,
    options: { fileName: string; inline: boolean; ttlSeconds?: number },
  ): Promise<string>;
  presignPreview(key: string): Promise<string>;
  /** Size and type of a stored object, or null if it isn't there. */
  head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  remove(keys: string[]): Promise<void>;
  /** The whole object, for server-side processing (imports). Refuses objects over maxBytes. */
  read(key: string, maxBytes: number): Promise<Buffer>;
}

export type StorageConfig = Pick<
  Config,
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_FORCE_PATH_STYLE'
>;

/** `attachment; filename*=UTF-8''…` — safe for any characters in the original name. */
function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION ?? 'auto',
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    // Otherwise the SDK signs a CRC32 of an empty body into presigned upload URLs, and R2/S3
    // reject the real upload with a checksum mismatch. The upload is verified on completion.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

/** Null when the S3_* settings are missing — file features then explain what to configure. */
export function createStorage(config: StorageConfig): Storage | null {
  const bucket = config.S3_BUCKET;
  if (!config.S3_ENDPOINT || !bucket || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  const client = createS3Client(config);

  return {
    presignUpload: (key, contentType, sizeBytes) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        { expiresIn: UPLOAD_TTL },
      ),

    presignDownload: (key, { fileName, inline, ttlSeconds = DOWNLOAD_TTL }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(fileName, inline),
        }),
        { expiresIn: ttlSeconds },
      ),

    presignPreview: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: PREVIEW_TTL,
      }),

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
          return null;
        }
        throw error;
      }
    },

    async read(key, maxBytes) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if ((result.ContentLength ?? 0) > maxBytes) {
        throw new Error(`Stored file is larger than ${String(maxBytes)} bytes`);
      }
      if (!result.Body) throw new Error('Stored file has no content');
      return Buffer.from(await result.Body.transformToByteArray());
    },

    async remove(keys) {
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}

/**
 * Development only: creates the bucket if it's missing and lets the web app upload to it from
 * the browser (CORS). In production the R2 bucket and its CORS rule are set up in Cloudflare.
 */
export async function prepareDevBucket(config: StorageConfig, appUrl: string): Promise<void> {
  const bucket = config.S3_BUCKET;
  if (!bucket || !config.S3_ENDPOINT) return;
  const client = createS3Client(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [appUrl],
            AllowedMethods: ['PUT', 'GET'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}
