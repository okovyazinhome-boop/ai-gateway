import express from "express";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

import { loadConfig } from "./config.js";
import { cleanupExpiredFiles, createStoredBase64File } from "./files.js";
import { handleUniversal, validateOpenAiKey } from "./openai.js";
import { handleUniversal as handleGeminiUniversal, validateGeminiKey } from "./gemini.js";
import { HttpError, toPublicError } from "./errors.js";
import { validateUniversalPayload } from "./validation.js";

const config = loadConfig();

export function createApp({ config: appConfig = config, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "75mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/files", express.static(appConfig.filesDir, {
    immutable: false,
    maxAge: "1h",
    setHeaders(res) {
      res.setHeader("X-Robots-Tag", "noindex");
    }
  }));

  app.post("/api/files/base64", async (req, res) => {
    try {
      requireStorageAuth(req);

      const stored = await createStoredBase64File({
        data: req.body?.data || req.body?.base64,
        mimeType: req.body?.mime_type || req.body?.mimeType || "application/octet-stream",
        extension: req.body?.extension,
        filesDir: appConfig.filesDir,
        publicBaseUrl: appConfig.publicBaseUrl,
        ttlMs: appConfig.fileTtlMs,
        convertPcmToWav: isTruthy(req.body?.convert_to_wav || req.body?.convertPcmToWav),
        outputFormat: req.body?.output_format || req.body?.outputFormat,
        sampleRate: Number(req.body?.sample_rate || req.body?.sampleRate || 24000),
        channels: Number(req.body?.channels || 1),
        bitsPerSample: Number(req.body?.bits_per_sample || req.body?.bitsPerSample || 16)
      });

      res.json({
        operation: "storage",
        status: "success",
        file_url: stored.url,
        url: stored.url,
        file_name: stored.fileName,
        mime_type: stored.mimeType,
        expires_at: stored.expiresAt.toISOString()
      });
    } catch (error) {
      const publicError = toPublicError(error);
      res.status(publicError.status).json({
        error: {
          message: publicError.message,
          details: publicError.details
        }
      });
    }
  });

  app.get("/api/openai/validate-key", async (req, res) => {
    try {
      const openaiApiKey = extractOpenAiKey(req);
      const result = await validateOpenAiKey({
        config: appConfig,
        openaiApiKey,
        fetchImpl
      });
      res.json(result);
    } catch (error) {
      const publicError = toPublicError(error);
      res.status(publicError.status).json({
        error: {
          message: publicError.message,
          details: publicError.details
        }
      });
    }
  });

  app.post("/api/openai/universal", async (req, res) => {
    try {
      const openaiApiKey = extractOpenAiKey(req);
      validateUniversalPayload(req.body, { openaiApiKey });

      const result = await handleUniversal(req.body, {
        config: appConfig,
        openaiApiKey,
        fetchImpl
      });

      res.json(result);
    } catch (error) {
      const publicError = toPublicError(error);
      res.status(publicError.status).json({
        error: {
          message: publicError.message,
          details: publicError.details
        }
      });
    }
  });

  app.get("/api/gemini/validate-key", async (req, res) => {
    try {
      const geminiApiKey = extractGeminiKey(req);
      const result = await validateGeminiKey({
        config: appConfig,
        geminiApiKey,
        fetchImpl
      });
      res.json(result);
    } catch (error) {
      const publicError = toPublicError(error);
      res.status(publicError.status).json({
        error: {
          message: publicError.message,
          details: publicError.details
        }
      });
    }
  });

  app.post("/api/gemini/universal", async (req, res) => {
    try {
      const geminiApiKey = extractGeminiKey(req);
      validateUniversalPayload(req.body, { geminiApiKey });

      const result = await handleGeminiUniversal(req.body, {
        config: appConfig,
        geminiApiKey,
        fetchImpl
      });

      res.json(result);
    } catch (error) {
      const publicError = toPublicError(error);
      res.status(publicError.status).json({
        error: {
          message: publicError.message,
          details: publicError.details
        }
      });
    }
  });

  return app;
}

export async function startServer() {
  await mkdir(config.filesDir, { recursive: true });
  await cleanupExpiredFiles({ filesDir: config.filesDir, ttlMs: config.fileTtlMs });

  setInterval(() => {
    cleanupExpiredFiles({ filesDir: config.filesDir, ttlMs: config.fileTtlMs }).catch((error) => {
      console.error("File cleanup failed", error);
    });
  }, 60 * 60 * 1000).unref();

  const app = createApp({ config });
  app.listen(config.port, () => {
    console.log(`AI Gateway backend listening on port ${config.port}`);
    console.log(`Serving ${basename(config.filesDir)} files from ${config.publicBaseUrl}/files/`);
  });
}

function extractOpenAiKey(req) {
  const explicit = req.get("x-openai-api-key");
  if (explicit) return explicit.trim();

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function extractGeminiKey(req) {
  const explicit = req.get("x-gemini-api-key") || req.get("x-goog-api-key");
  if (explicit) return explicit.trim();

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireStorageAuth(req) {
  if (extractOpenAiKey(req) || extractGeminiKey(req)) return;

  throw new HttpError(401, "Для сохранения файла нужен API key в заголовке x-openai-api-key или x-gemini-api-key.");
}

function isTruthy(value) {
  return value === true || value === "true" || value === "yes" || value === "1";
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
