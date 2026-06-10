import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { HttpError } from "./errors.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);

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

export async function createStoredBase64File({
  data,
  mimeType,
  extension,
  filesDir,
  publicBaseUrl,
  now = new Date(),
  ttlMs = DEFAULT_TTL_MS,
  maxBytes = 50 * 1024 * 1024,
  convertPcmToWav = false,
  outputFormat,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
}) {
  const base64 = normalizeBase64Data(data);
  let buffer = Buffer.from(base64, "base64");
  let finalMimeType = mimeType;
  let finalExtension = extension;

  if (!buffer.length) {
    throw new HttpError(400, "Файл пустой или base64 некорректный.");
  }

  if (buffer.byteLength > maxBytes) {
    throw new HttpError(413, `Файл слишком большой. Максимум: ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }

  if (convertPcmToWav || isPcmMimeType(mimeType)) {
    buffer = pcmToWav(buffer, sampleRate, channels, bitsPerSample);
    finalMimeType = "audio/wav";
    finalExtension = "wav";
  }

  if (String(outputFormat || "").toLowerCase() === "mp3") {
    buffer = await wavToMp3(buffer);
    finalMimeType = "audio/mpeg";
    finalExtension = "mp3";
  }

  return createStoredFile({
    buffer,
    mimeType: finalMimeType,
    extension: finalExtension,
    filesDir,
    publicBaseUrl,
    now,
    ttlMs
  });
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

function normalizeBase64Data(data) {
  const value = String(data || "").trim();
  const match = value.match(/^data:([^;,]+)?;base64,(.+)$/i);
  return match ? match[2] : value;
}

function isPcmMimeType(mimeType) {
  return String(mimeType || "").toLowerCase().startsWith("audio/l16");
}

export function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function wavToMp3(wavBuffer) {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-gateway-mp3-"));
  const inputPath = join(tempDir, "input.wav");
  const outputPath = join(tempDir, "output.mp3");

  try {
    await writeFile(inputPath, wavBuffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);
    return await readFile(outputPath);
  } catch (error) {
    throw new HttpError(500, "Не удалось конвертировать аудио в MP3. Проверьте, что ffmpeg установлен в backend.", String(error?.message || error));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
