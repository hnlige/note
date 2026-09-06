import { randomUUID } from 'node:crypto';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

export type CosConfig = {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  prefix: string;
};

export type StoredAttachment = {
  id: string;
  name: string;
  storageKey: string;
  size: string;
  type: string;
  uploadedAt: string;
};

type AttachmentLike = Partial<StoredAttachment> & { url?: string };

export function getCosConfig(env: NodeJS.ProcessEnv = process.env): CosConfig | null {
  const secretId = env.COS_SECRET_ID?.trim();
  const secretKey = env.COS_SECRET_KEY?.trim();
  const bucket = env.COS_BUCKET?.trim();
  const region = env.COS_REGION?.trim();
  if (!secretId || !secretKey || !bucket || !region) return null;
  return {
    secretId,
    secretKey,
    bucket,
    region,
    prefix: (env.COS_PREFIX || 'duban').replace(/^\/+|\/+$/g, ''),
  };
}

export function getMaxAttachmentBytes(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.MAX_ATTACHMENT_BYTES);
  if (!Number.isInteger(configured) || configured <= 0) return 50 * 1024 * 1024;
  return Math.min(configured, 50 * 1024 * 1024);
}

export function sanitizeAttachmentName(name: string): string {
  const baseName = Array.from(path.basename(name).replace(/[<>:"/\\|?*]/g, '_'), (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  ).join('').trim();
  return (baseName || 'attachment').slice(0, 180);
}

export function buildAttachmentObjectKey(config: CosConfig, itemId: string, fileName: string, id = randomUUID()): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
  const prefix = config.prefix ? `${config.prefix}/` : '';
  return `${prefix}attachments/${day}/${itemId}/${id}-${sanitizeAttachmentName(fileName)}`;
}

function createCosClient(config: CosConfig): COS {
  return new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
}

export async function uploadAttachment(input: {
  itemId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredAttachment> {
  const env = input.env || process.env;
  const config = getCosConfig(env);
  if (!config) throw new Error('对象存储尚未配置');
  if (!input.body.length || input.body.length > getMaxAttachmentBytes(env)) throw new Error('附件大小不符合限制');

  const id = randomUUID();
  const name = sanitizeAttachmentName(input.fileName);
  const storageKey = buildAttachmentObjectKey(config, input.itemId, name, id);
  const contentType = input.contentType || 'application/octet-stream';
  const cos = createCosClient(config);
  await cos.putObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: storageKey,
    Body: input.body,
    ContentType: contentType,
    ACL: 'private',
  });

  return {
    id,
    name,
    storageKey,
    size: `${(input.body.length / 1024).toFixed(1)}KB`,
    type: contentType,
    uploadedAt: new Date().toISOString().slice(0, 10),
  };
}

export function resolveAttachmentUrl<T extends AttachmentLike>(attachment: T, env: NodeJS.ProcessEnv = process.env): T {
  if (!attachment.storageKey) return attachment;
  const config = getCosConfig(env);
  if (!config) return { ...attachment, url: '' };
  const cos = createCosClient(config);
  return {
    ...attachment,
    url: cos.getObjectUrl({
      Bucket: config.bucket,
      Region: config.region,
      Key: attachment.storageKey,
      Sign: true,
      Method: 'GET',
      Expires: Number(env.COS_SIGNED_URL_TTL_SECONDS) || 300,
    }),
  };
}

export function resolveAttachmentUrls<T extends AttachmentLike>(attachments: T[] | undefined, env: NodeJS.ProcessEnv = process.env): T[] {
  return (attachments || []).map((attachment) => resolveAttachmentUrl(attachment, env));
}
