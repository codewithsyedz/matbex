/** Byte storage backends: local filesystem (default) or any S3-compatible service (AWS S3, MinIO, R2, Wasabi). */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

export interface StoredObject {
  body: Readable;
  size?: number;
}

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  remove(keys: string[]): Promise<void>;
}

class FsDriver implements StorageDriver {
  private root = resolve(config.STORAGE_FS_ROOT);
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("invalid object key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(Readable.from(body), createWriteStream(p));
  }
  async get(key: string) {
    const p = this.path(key);
    try {
      const s = await stat(p);
      return { body: createReadStream(p), size: s.size };
    } catch {
      return null;
    }
  }
  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }
}

class S3Driver implements StorageDriver {
  private s3 = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  async put(key: string, body: Buffer, contentType: string, cacheControl?: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
  }
  async get(key: string) {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
      return { body: out.Body as Readable, size: out.ContentLength };
    } catch (e: any) {
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async remove(keys: string[]) {
    if (!keys.length) return;
    await this.s3.send(new DeleteObjectsCommand({ Bucket: config.S3_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  }
}

export const driver: StorageDriver = config.STORAGE_DRIVER === "s3" ? new S3Driver() : new FsDriver();
