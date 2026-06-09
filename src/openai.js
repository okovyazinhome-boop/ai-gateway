import { randomUUID } from "node:crypto";

import { downloadUrl } from "./download.js";
import { HttpError } from "./errors.js";
import { createStoredFile, extensionFromMime } from "./files.js";
import { shapeChatResponse, shapeImageResponse, shapeTtsResponse } from "./shape.js";
import { shapeTranscriptionResponse } from "./subtitles.js";

export async function handleUniversal(payload, context) {
  if (payload.operation === "chat") {
    return handleChat(payload.chat || {}, context);
  }

  if (payload.operation === "image") {
    return handleImage(payload.image || {}, context);
  }

  if (payload.operation === "audio") {
    return handleAudio(payload.audio || {}, context);
  }

  throw new HttpError(400, "Неизвестная операция.");
}

export async function validateOpenAiKey(context) {
  const response = await context.fetchImpl(`${context.config.openaiBaseUrl}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${context.openaiApiKey}` }
  });

  if (!response.ok) {
    await throwOpenAiError(response);
  }

  return { ok: true };
}

async function handleChat(chat, context) {
  const model = chat.model || "gpt-5.5";
  const requestBody = {
    model,
    input: buildResponsesInput(chat),
    stream: Boolean(chat.stream)
  };

  if (chat.reasoning_effort) {
    requestBody.reasoning = { effort: chat.reasoning_effort };
  }

  if (chat.web_search === true || chat.web_search === "true") {
    requestBody.tools = [{ type: "web_search_preview" }];
  }

  if (isTruthy(chat.structured_output)) {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: chat.json_schema_name || "structured_response",
        schema: parseJsonField(chat.json_schema, "JSON Schema"),
        strict: true
      }
    };
  }

  if (isTruthy(chat.function_calling)) {
    requestBody.tools = parseJsonField(chat.functions, "Functions (JSON)").map(normalizeFunctionTool);
    if (chat.tool_choice) {
      requestBody.tool_choice = chat.tool_choice;
    }
  }

  const raw = requestBody.stream
    ? await openaiStreamJson("/responses", requestBody, context)
    : await openaiJson("/responses", requestBody, context);

  return shapeChatResponse(raw);
}

async function handleImage(image, context) {
  const startedAt = new Date();
  const model = image.model || "gpt-image-2";
  const jobId = `job_${randomUUID()}`;
  const inputUrls = cleanStringList(image.input_urls || []);

  const raw =
    inputUrls.length > 0
      ? await editImage({ image, model, inputUrls, context })
      : await generateImage({ image, model, context });

  const base64 = raw?.data?.[0]?.b64_json;
  if (!base64) {
    throw new HttpError(502, "OpenAI не вернул изображение в base64.", raw);
  }

  const outputFormat = image.output_format || "png";
  const mimeType = `image/${outputFormat === "jpg" ? "jpeg" : outputFormat}`;
  const stored = await createStoredFile({
    buffer: Buffer.from(base64, "base64"),
    mimeType,
    extension: outputFormat,
    filesDir: context.config.filesDir,
    publicBaseUrl: context.config.publicBaseUrl,
    ttlMs: context.config.fileTtlMs
  });

  return shapeImageResponse({
    model,
    jobId,
    startedAt,
    completedAt: new Date(),
    image: stored,
    raw: redactImageBase64(raw)
  });
}

async function generateImage({ image, model, context }) {
  return openaiJson(
    "/images/generations",
    {
      model,
      prompt: image.prompt,
      n: 1,
      size: image.size || mapAspectToSize(image.aspect_ratio, image.resolution),
      quality: image.quality || "auto",
      output_format: image.output_format || "png"
    },
    context
  );
}

async function editImage({ image, model, inputUrls, context }) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", image.prompt);
  form.set("n", "1");
  form.set("size", image.size || mapAspectToSize(image.aspect_ratio, image.resolution));
  form.set("quality", image.quality || "auto");
  form.set("output_format", image.output_format || "png");

  for (const url of inputUrls) {
    const file = await downloadUrl(url, {
      maxBytes: context.config.maxDownloadBytes,
      fetchImpl: context.fetchImpl
    });
    form.append("image[]", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
  }

  return openaiMultipart("/images/edits", form, context);
}

async function handleAudio(audio, context) {
  if (audio.audio_operation === "transcribe") {
    return transcribeAudio(audio, context);
  }

  if (audio.audio_operation === "tts") {
    return textToSpeech(audio, context);
  }

  throw new HttpError(400, "Неизвестная аудио-операция.");
}

async function transcribeAudio(audio, context) {
  const model = audio.timestamps ? "whisper-1" : audio.model || "gpt-4o-transcribe";
  const isDiarize = model === "gpt-4o-transcribe-diarize";
  const file = await downloadUrl(audio.audio_url, {
    maxBytes: context.config.maxDownloadBytes,
    fetchImpl: context.fetchImpl
  });

  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
  form.set("response_format", responseFormatForTranscription(model));
  if (audio.language) form.set("language", audio.language);
  if (audio.prompt && !isDiarize) form.set("prompt", audio.prompt);
  if (model === "whisper-1" && audio.timestamps) {
    form.append("timestamp_granularities[]", "segment");
    form.append("timestamp_granularities[]", "word");
  }
  if (isDiarize) {
    form.set("chunking_strategy", "auto");
  }

  const raw = await openaiMultipart("/audio/transcriptions", form, context);
  return shapeTranscriptionResponse({ model, raw });
}

function responseFormatForTranscription(model) {
  if (model === "whisper-1") return "verbose_json";
  if (model === "gpt-4o-transcribe-diarize") return "diarized_json";
  return "json";
}

async function textToSpeech(audio, context) {
  const model = audio.model || "gpt-4o-mini-tts";
  const format = audio.format || "mp3";
  const speed = normalizeOptionalNumber(audio.speed) ?? 1;
  const rawResponse = await openaiBinary(
    "/audio/speech",
    {
      model,
      voice: audio.voice || "marin",
      input: audio.text,
      instructions: audio.instructions || undefined,
      response_format: format,
      speed
    },
    context
  );

  const mimeType = mimeFromAudioFormat(format);
  const stored = await createStoredFile({
    buffer: rawResponse.buffer,
    mimeType,
    extension: extensionFromMime(mimeType),
    filesDir: context.config.filesDir,
    publicBaseUrl: context.config.publicBaseUrl,
    ttlMs: context.config.fileTtlMs
  });

  return shapeTtsResponse({
    model,
    voice: audio.voice || "marin",
    speed,
    audio: stored,
    raw: { response_headers: rawResponse.headers }
  });
}

function buildResponsesInput(chat) {
  const messages = [];

  if (chat.developer_instruction) {
    messages.push({
      role: "developer",
      content: [{ type: "input_text", text: chat.developer_instruction }]
    });
  }

  if (chat.memory) {
    const memory = parseMemory(chat.memory);
    messages.push(...memory);
  }

  const content = [{ type: "input_text", text: chat.user_prompt }];
  for (const url of cleanStringList(chat.media_urls || [])) {
    content.push({ type: "input_image", image_url: url });
  }

  messages.push({ role: "user", content });
  return messages;
}

function parseMemory(memory) {
  if (!memory) return [];
  if (Array.isArray(memory)) return memory;
  try {
    const parsed = JSON.parse(memory);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new HttpError(400, "Memory должен быть JSON-массивом сообщений.");
  }
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFunctionTool(tool) {
  if (tool?.type === "function") return tool;
  return {
    type: "function",
    name: tool.name,
    description: tool.description || "",
    parameters: tool.parameters || {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  };
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

async function openaiJson(path, body, context) {
  const response = await context.fetchImpl(`${context.config.openaiBaseUrl}${path}`, {
    method: "POST",
    headers: openaiHeaders(context.openaiApiKey),
    body: JSON.stringify(stripUndefined(body))
  });
  return readJsonResponse(response);
}

async function openaiMultipart(path, form, context) {
  const response = await context.fetchImpl(`${context.config.openaiBaseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${context.openaiApiKey}` },
    body: form
  });
  return readJsonResponse(response);
}

async function openaiBinary(path, body, context) {
  const response = await context.fetchImpl(`${context.config.openaiBaseUrl}${path}`, {
    method: "POST",
    headers: openaiHeaders(context.openaiApiKey),
    body: JSON.stringify(stripUndefined(body))
  });

  if (!response.ok) {
    await throwOpenAiError(response);
  }

  const headers = Object.fromEntries(response.headers.entries());
  return {
    headers,
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

async function openaiStreamJson(path, body, context) {
  const response = await context.fetchImpl(`${context.config.openaiBaseUrl}${path}`, {
    method: "POST",
    headers: openaiHeaders(context.openaiApiKey),
    body: JSON.stringify(stripUndefined(body))
  });

  if (!response.ok) {
    await throwOpenAiError(response);
  }

  const text = await response.text();
  const events = parseSse(text);
  const completed = [...events].reverse().find((event) => event.type === "response.completed");
  if (completed?.response) return completed.response;

  const outputText = events
    .filter((event) => event.type === "response.output_text.delta")
    .map((event) => event.delta || "")
    .join("");

  return {
    id: null,
    model: body.model,
    status: "completed",
    output_text: outputText,
    usage: {},
    raw_stream: text
  };
}

function parseSse(text) {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) return null;
      const data = dataLine.slice(6);
      if (data === "[DONE]") return null;
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    await throwOpenAiError(response, text);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "OpenAI вернул не-JSON ответ.", text);
  }
}

async function throwOpenAiError(response, knownText = null) {
  const text = knownText ?? (await response.text());
  let details = text;
  let message = `OpenAI API вернул ошибку ${response.status}.`;

  try {
    const parsed = JSON.parse(text);
    details = parsed;
    message = parsed.error?.message || message;
  } catch {
    // Keep raw text.
  }

  throw new HttpError(response.status, message, details);
}

function openaiHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function mapAspectToSize(aspectRatio = "1:1", resolution = "auto") {
  const high = resolution === "2K" || resolution === "high";
  const map = {
    "1:1": high ? "1536x1536" : "1024x1024",
    "9:16": high ? "1024x1536" : "1024x1536",
    "16:9": high ? "1536x1024" : "1536x1024",
    "4:3": "1536x1024",
    "3:4": "1024x1536"
  };

  return map[aspectRatio] || "1024x1024";
}

function mimeFromAudioFormat(format) {
  const map = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    opus: "audio/ogg",
    aac: "audio/aac",
    flac: "audio/flac"
  };
  return map[format] || "audio/mpeg";
}

function redactImageBase64(raw) {
  return {
    ...raw,
    data: (raw.data || []).map((item) => ({
      ...item,
      b64_json: item.b64_json ? "[base64 omitted]" : item.b64_json
    }))
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
}
