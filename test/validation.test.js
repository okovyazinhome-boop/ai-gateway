import test from "node:test";
import assert from "node:assert/strict";

import { validateUniversalPayload } from "../src/validation.js";

test("validateUniversalPayload requires an OpenAI API key", () => {
  assert.throws(
    () => validateUniversalPayload({ operation: "chat", chat: { user_prompt: "Hi" } }, {}),
    /OpenAI API key/
  );
});

test("validateUniversalPayload rejects unsupported operations", () => {
  assert.throws(
    () => validateUniversalPayload({ operation: "video" }, { openaiApiKey: "sk-test" }),
    /operation/
  );
});

test("validateUniversalPayload validates image input URL protocols", () => {
  assert.throws(
    () =>
      validateUniversalPayload(
        {
          operation: "image",
          image: {
            prompt: "test",
            input_urls: ["ftp://example.com/image.png"]
          }
        },
        { openaiApiKey: "sk-test" }
      ),
    /HTTP и HTTPS URL/
  );
});

test("validateUniversalPayload accepts http and https image input URLs", () => {
  const result = validateUniversalPayload(
    {
      operation: "image",
      image: {
        prompt: "test",
        input_urls: ["http://example.com/image.png", "https://example.com/image-2.png"]
      }
    },
    { openaiApiKey: "sk-test" }
  );

  assert.equal(result.operation, "image");
});

test("validateUniversalPayload ignores blank image input URL items", () => {
  const result = validateUniversalPayload(
    {
      operation: "image",
      image: {
        prompt: "test",
        input_urls: ["", "   "]
      }
    },
    { openaiApiKey: "sk-test" }
  );

  assert.equal(result.operation, "image");
});

test("validateUniversalPayload accepts a minimal chat payload", () => {
  const result = validateUniversalPayload(
    { operation: "chat", chat: { user_prompt: "Напиши текст" } },
    { openaiApiKey: "sk-test" }
  );

  assert.equal(result.operation, "chat");
});

test("validateUniversalPayload accepts structured output JSON schema", () => {
  const result = validateUniversalPayload(
    {
      operation: "chat",
      chat: {
        user_prompt: "Верни JSON",
        structured_output: true,
        json_schema: {
          type: "object",
          properties: {
            title: { type: "string" }
          },
          required: ["title"],
          additionalProperties: false
        }
      }
    },
    { openaiApiKey: "sk-test" }
  );

  assert.equal(result.operation, "chat");
});

test("validateUniversalPayload validates TTS speed range", () => {
  assert.throws(
    () =>
      validateUniversalPayload(
        {
          operation: "audio",
          audio: {
            audio_operation: "tts",
            text: "Привет",
            speed: 5
          }
        },
        { openaiApiKey: "sk-test" }
      ),
    /Скорость речи/
  );
});

test("validateUniversalPayload rejects conflicting chat tool modes", () => {
  assert.throws(
    () =>
      validateUniversalPayload(
        {
          operation: "chat",
          chat: {
            user_prompt: "Верни JSON",
            structured_output: true,
            web_search: true,
            json_schema: { type: "object", properties: {}, required: [] }
          }
        },
        { openaiApiKey: "sk-test" }
      ),
    /Structured Output/
  );
});
