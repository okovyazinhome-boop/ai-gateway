import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function createStoredFile({
  buffer,
  mimeType,
  extension,
  filesDir,
  publicBaseUrl,
  now = new Date(),
  ttlMs = DEFAULT_TTL_MS
}) {
  await mkdir(filesDir, { recursive: true });

  const safeExtension = String(extension || extensionFromMime(mimeType) || "bin").replace(/^\./, "");
  const fileName = `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.${safeExtension}`;
  const filePath = join(filesDir, fileName);
  await writeFile(filePath, buffer);

  const base = publicBaseUrl.replace(/\/+$/, "");
  return {
    url: `${base}/files/${encodeURIComponent(fileName)}`,
    fileName,
    mimeType,
    filePath,
    expiresAt: new Date(now.getTime() + ttlMs)
  };
}

export async function cleanupExpiredFiles({ filesDir, ttlMs = DEFAULT_TTL_MS, now = new Date() }) {
  await mkdir(filesDir, { recursive: true });
  const entries = await readdir(filesDir);
  const deleted = [];
  const cutoff = now.getTime() - ttlMs;

  for (const entry of entries) {
    const filePath = join(filesDir, entry);
    const info = await stat(filePath);
    if (!info.isFile()) continue;

    if (info.mtimeMs < cutoff) {
      await unlink(filePath);
      deleted.push(entry);
    }
  }

  return deleted;
}

export function extensionFromMime(mimeType) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "text/plain": "txt"
  };

  return map[mimeType] || "bin";
}
