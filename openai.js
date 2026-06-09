import { HttpError } from "./errors.js";
import { extensionFromMime } from "./files.js";

export async function downloadUrl(url, { maxBytes, fetchImpl = fetch }) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new HttpError(400, `Не удалось скачать файл по URL: ${url}`, {
      status: response.status,
      statusText: response.statusText
    });
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new HttpError(400, `Файл слишком большой: максимум ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `Файл слишком большой: максимум ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  return {
    buffer,
    mimeType,
    extension: extensionFromMime(mimeType),
    fileName: fileNameFromUrl(url, extensionFromMime(mimeType))
  };
}

function fileNameFromUrl(value, fallbackExtension) {
  try {
    const parsed = new URL(value);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name || `input.${fallbackExtension || "bin"}`;
  } catch {
    return `input.${fallbackExtension || "bin"}`;
  }
}
