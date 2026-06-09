import { join, resolve } from "node:path";

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const publicBaseUrl = env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const filesDir = resolve(env.FILES_DIR || join(process.cwd(), "public", "files"));
  const fileTtlHours = Number(env.FILE_TTL_HOURS || 24);
  const maxDownloadMb = Number(env.MAX_DOWNLOAD_MB || 25);

  return {
    port,
    publicBaseUrl,
    filesDir,
    fileTtlMs: fileTtlHours * 60 * 60 * 1000,
    maxDownloadBytes: maxDownloadMb * 1024 * 1024,
    openaiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  };
}
