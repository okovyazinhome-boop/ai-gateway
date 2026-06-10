import express from "express";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

import { loadConfig } from "./config.js";
import { cleanupExpiredFiles } from "./files.js";
import { handleUniversal, validateGeminiKey } from "./gemini.js";
import { toPublicError } from "./errors.js";
import { validateUniversalPayload } from "./validation.js";

const config = loadConfig();

export function createApp({ config: appConfig = config, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

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

      const result = await handleUniversal(req.body, {
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
    console.log(`Gemini Make backend listening on port ${config.port}`);
    console.log(`Serving ${basename(config.filesDir)} files from ${config.publicBaseUrl}/files/`);
  });
}

function extractGeminiKey(req) {
  const explicit = req.get("x-gemini-api-key") || req.get("x-goog-api-key");
  if (explicit) return explicit.trim();

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
