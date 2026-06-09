import test from "node:test";
import assert from "node:assert/strict";

import { shapeChatResponse, shapeImageResponse, shapeTtsResponse } from "../src/shape.js";

test("shapeChatResponse exposes stable mappable chat fields", () => {
  const raw = {
    id: "resp_123",
    model: "gpt-5.2",
    output_text: "{\"ok\":true}",
    status: "completed",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15
    },
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "{\"ok\":true}" }]
      }
    ]
  };

  const result = shapeChatResponse(raw);

  assert.equal(result.operation, "chat");
  assert.equal(result.id, "resp_123");
  assert.equal(result.role, "assistant");
  assert.equal(result.model, "gpt-5.2");
  assert.equal(result.text, "{\"ok\":true}");
  assert.deepEqual(result.parsed_json, { ok: true });
  assert.deepEqual(result.usage, {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15
  });
  assert.equal(result.finish_reason, "completed");
  assert.equal(result.raw, raw);
});

test("shapeImageResponse returns one primary URL plus future-proof array metadata", () => {
  const now = new Date("2026-06-09T10:00:00.000Z");
  const result = shapeImageResponse({
    model: "gpt-image-2",
    jobId: "job_123",
    startedAt: new Date("2026-06-09T09:59:00.000Z"),
    completedAt: now,
    image: {
      url: "https://cdn.example.com/files/image.png",
      fileName: "image.png",
      mimeType: "image/png",
      expiresAt: new Date("2026-06-10T10:00:00.000Z")
    },
    raw: { data: [{ b64_json: "redacted" }] }
  });

  assert.equal(result.operation, "image");
  assert.equal(result.status, "success");
  assert.equal(result.job_id, "job_123");
  assert.equal(result.duration_seconds, 60);
  assert.equal(result.image_url, "https://cdn.example.com/files/image.png");
  assert.deepEqual(result.image_urls, ["https://cdn.example.com/files/image.png"]);
  assert.equal(result.file_name, "image.png");
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.expires_at, "2026-06-10T10:00:00.000Z");
});

test("shapeTtsResponse exposes an audio URL and file metadata", () => {
  const result = shapeTtsResponse({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    audio: {
      url: "https://cdn.example.com/files/speech.mp3",
      fileName: "speech.mp3",
      mimeType: "audio/mpeg",
      expiresAt: new Date("2026-06-10T10:00:00.000Z")
    },
    raw: { request_id: "req_123" }
  });

  assert.equal(result.operation, "audio");
  assert.equal(result.audio_operation, "tts");
  assert.equal(result.audio_url, "https://cdn.example.com/files/speech.mp3");
  assert.equal(result.file_name, "speech.mp3");
  assert.equal(result.mime_type, "audio/mpeg");
  assert.equal(result.model, "gpt-4o-mini-tts");
  assert.equal(result.voice, "marin");
});
