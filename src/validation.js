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
  validateUrlList(chat.media_urls || [], "Media URL");
}

function validateImage(image) {
  assertRequired(image.prompt, "Для изображения заполните промпт.");
  const urls = image.input_urls || [];
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
    validateHttpsUrl(audio.audio_url, "Audio URL");
  }

  if (audio.audio_operation === "tts") {
    assertRequired(audio.text, "Для Text to Speech заполните текст.");
  }
}

function validateUrlList(urls, fieldName) {
  if (!Array.isArray(urls)) {
    throw new HttpError(400, `${fieldName} должен быть массивом URL.`);
  }

  for (const url of urls) {
    validateHttpsUrl(url, fieldName);
  }
}

export function validateHttpsUrl(value, fieldName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, `${fieldName}: укажите корректный HTTPS URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new HttpError(400, `${fieldName}: поддерживаются только HTTPS URL.`);
  }
}
