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

test("validateUniversalPayload validates image input URL limits and protocols", () => {
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
    /HTTPS URL/
  );
});

test("validateUniversalPayload accepts a minimal chat payload", () => {
  const result = validateUniversalPayload(
    { operation: "chat", chat: { user_prompt: "Напиши текст" } },
    { openaiApiKey: "sk-test" }
  );

  assert.equal(result.operation, "chat");
});
