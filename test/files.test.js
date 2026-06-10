import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanupExpiredFiles, createStoredBase64File, createStoredFile } from "../src/files.js";

test("createStoredFile writes a file and returns a public URL plus expiry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openai-make-files-"));
  const now = new Date("2026-06-09T10:00:00.000Z");

  const stored = await createStoredFile({
    buffer: Buffer.from("hello"),
    mimeType: "text/plain",
    extension: "txt",
    filesDir: dir,
    publicBaseUrl: "https://openai.example.com",
    now
  });

  assert.match(stored.url, /^https:\/\/openai\.example\.com\/files\/.+\.txt$/);
  assert.equal(stored.mimeType, "text/plain");
  assert.equal(stored.expiresAt.toISOString(), "2026-06-10T10:00:00.000Z");
  const saved = await stat(join(dir, stored.fileName));
  assert.equal(saved.size, 5);
});

test("createStoredBase64File writes data URL payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openai-make-base64-files-"));
  const now = new Date("2026-06-09T10:00:00.000Z");

  const stored = await createStoredBase64File({
    data: "data:text/plain;base64,aGVsbG8=",
    mimeType: "text/plain",
    extension: "txt",
    filesDir: dir,
    publicBaseUrl: "https://ai.example.com",
    now
  });

  assert.match(stored.url, /^https:\/\/ai\.example\.com\/files\/.+\.txt$/);
  assert.equal(stored.mimeType, "text/plain");
  assert.equal(stored.expiresAt.toISOString(), "2026-06-10T10:00:00.000Z");
  const saved = await stat(join(dir, stored.fileName));
  assert.equal(saved.size, 5);
});

test("cleanupExpiredFiles deletes files older than the configured TTL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openai-make-cleanup-"));
  const oldFile = join(dir, "old.txt");
  const freshFile = join(dir, "fresh.txt");
  await writeFile(oldFile, "old");
  await writeFile(freshFile, "fresh");

  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await import("node:fs/promises").then(({ utimes }) => utimes(oldFile, twoDaysAgo, twoDaysAgo));

  const deleted = await cleanupExpiredFiles({
    filesDir: dir,
    ttlMs: 24 * 60 * 60 * 1000,
    now: new Date()
  });

  assert.deepEqual(deleted, ["old.txt"]);
  await assert.rejects(stat(oldFile));
  assert.equal((await stat(freshFile)).isFile(), true);
});
