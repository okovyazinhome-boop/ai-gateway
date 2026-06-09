import { HttpError, assertRequired } from "./errors.js";

const OPERATIONS = new Set(["chat", "image", "audio"]);
const AUDIO_OPERATIONS = new Set(["transcribe", "tts"]);

export function validateUniversalPayload(payload, context) {
  assertRequired(context.openaiApiKey, "OpenAI API key обязателен.");

  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Тело запроса должно быть JSON-объектом.");
  }

  const operation = payload.operation;
  if (!OPERATIONS.has(operation)) {
    throw new HttpError(400, "Поле operation должно быть одним из: chat, image, audio.");
  }

  if (operation === "chat") {
    validateChat(payload.chat || {});
  }

  if (operation === "image") {
    validateImage(payload.image || {});
  }

  if (operation === "audio") {
    validateAudio(payload.audio || {});
  }

  return payload;
}

function validateChat(chat) {
  assertRequired(chat.user_prompt, "Для чата заполните сообщение пользователя.");
  validateUrlList(cleanUrlList(chat.media_urls || []), "Media URL");

  const structuredOutput = isTruthy(chat.structured_output);
  const functionCalling = isTruthy(chat.function_calling);
  const webSearch = isTruthy(chat.web_search);

  if (structuredOutput && webSearch) {
    throw new HttpError(400, "Structured Output нельзя использовать вместе с Web Search.");
  }

  if (structuredOutput && functionCalling) {
    throw new HttpError(400, "Structured Output нельзя использовать вместе с Function Calling в этом модуле.");
  }

  if (functionCalling && webSearch) {
    throw new HttpError(400, "Function Calling нельзя использовать вместе с Web Search в этом модуле.");
  }

  if (structuredOutput) {
    assertRequired(chat.json_schema, "Для Structured Output заполните JSON Schema.");
    const schema = parseJsonField(chat.json_schema, "JSON Schema");
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      throw new HttpError(400, "JSON Schema должна быть JSON-объектом.");
    }
  }

  if (functionCalling) {
    assertRequired(chat.functions, "Для Function Calling заполните Functions (JSON).");
    const functions = parseJsonField(chat.functions, "Functions (JSON)");
    if (!Array.isArray(functions) || functions.length === 0) {
      throw new HttpError(400, "Functions (JSON) должен быть непустым JSON-массивом функций.");
    }
  }
}

function validateImage(image) {
  assertRequired(image.prompt, "Для изображения заполните промпт.");
  const urls = cleanUrlList(image.input_urls || []);
  if (urls.length > 16) {
    throw new HttpError(400, "URL исходных изображений: максимум 16 ссылок.");
  }
  validateUrlList(urls, "URL исходных изображений");
}

function validateAudio(audio) {
  if (!AUDIO_OPERATIONS.has(audio.audio_operation)) {
    throw new HttpError(400, "Для аудио выберите audio_operation: transcribe или tts.");
  }

  if (audio.audio_operation === "transcribe") {
    assertRequired(audio.audio_url, "Для transcribe заполните Audio URL.");
    validateHttpUrl(audio.audio_url, "Audio URL");
  }

  if (audio.audio_operation === "tts") {
    assertRequired(audio.text, "Для Text to Speech заполните текст.");
    validateOptionalNumberRange(audio.speed, "Скорость речи", 0.25, 4);
  }
}

function validateUrlList(urls, fieldName) {
  if (!Array.isArray(urls)) {
    throw new HttpError(400, `${fieldName} должен быть массивом URL.`);
  }

  for (const url of urls) {
    validateHttpUrl(url, fieldName);
  }
}

function cleanUrlList(urls) {
  if (!Array.isArray(urls)) return urls;
  return urls.map((url) => String(url || "").trim()).filter(Boolean);
}

function validateOptionalNumberRange(value, fieldName, min, max) {
  if (value === undefined || value === null || value === "") return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${fieldName}: укажите число от ${min} до ${max}.`);
  }
}

export function validateHttpUrl(value, fieldName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, `${fieldName}: укажите корректный HTTP или HTTPS URL.`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(400, `${fieldName}: поддерживаются только HTTP и HTTPS URL.`);
  }
}

function isTruthy(value) {
  return value === true || value === "true" || value === "yes";
}

function parseJsonField(value, fieldName) {
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(400, `${fieldName}: укажите корректный JSON.`);
  }
}
