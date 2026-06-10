import { randomUUID } from "node:crypto";

import { downloadUrl } from "./download.js";
import { HttpError } from "./errors.js";
import { createStoredFile, extensionFromMime } from "./files.js";
import { shapeChatResponse, shapeImageResponse, shapeTtsResponse } from "./shape.js";
import { shapeTranscriptionResponse } from "./subtitles.js";

const DEFAULT_CHAT_MODEL = "gemini-3.5-flash";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_TRANSCRIBE_MODEL = "gemini-3.5-flash";

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

export async function validateGeminiKey(context) {
  const response = await context.fetchImpl(`${context.config.geminiBaseUrl}/models`, {
    method: "GET",
    headers: geminiHeaders(context.geminiApiKey)
  });

  if (!response.ok) {
    await throwGeminiError(response);
  }

  return { ok: true };
}

async function handleChat(chat, context) {
  const model = chat.model || DEFAULT_CHAT_MODEL;
  const body = {
    contents: await buildTextContents(chat, context),
    generationConfig: buildChatGenerationConfig(chat)
  };

  if (chat.developer_instruction) {
    body.system_instruction = { parts: [{ text: chat.developer_instruction }] };
  }

  const tools = buildTools(chat);
  if (tools.length > 0) {
    body.tools = tools;
  }

  const raw = await geminiJson(`/models/${model}:generateContent`, body, context);
  return shapeChatResponse({ ...raw, model });
}

async function buildTextContents(chat, context) {
  const contents = [];

  for (const item of parseMemory(chat.memory)) {
    contents.push({
      role: normalizeGeminiRole(item.role),
      parts: [{ text: extractMessageText(item.content) }]
    });
  }

  const parts = [{ text: chat.user_prompt }];
  for (const url of cleanStringList(chat.media_urls || [])) {
    const file = await downloadUrl(url, {
      maxBytes: context.config.maxDownloadBytes,
      fetchImpl: context.fetchImpl
    });
    parts.push(toInlineDataPart(file));
  }

  contents.push({ role: "user", parts });
  return contents;
}

function buildChatGenerationConfig(chat) {
  const generationConfig = {};

  if (chat.reasoning_effort) {
    generationConfig.thinkingConfig = {
      thinkingLevel: mapThinkingLevel(chat.reasoning_effort)
    };
  }

  if (isTruthy(chat.structured_output)) {
    generationConfig.responseFormat = {
      text: {
        mimeType: "application/json",
        schema: parseJsonField(chat.json_schema, "JSON Schema")
      }
    };
  }

  return Object.keys(generationConfig).length > 0 ? generationConfig : undefined;
}

function buildTools(chat) {
  const tools = [];

  if (isTruthy(chat.web_search)) {
    tools.push({ google_search: {} });
  }

  if (isTruthy(chat.function_calling)) {
    tools.push({
      function_declarations: parseJsonField(chat.functions, "Functions (JSON)").map(normalizeFunctionDeclaration)
    });
  }

  return tools;
}

async function handleImage(image, context) {
  const startedAt = new Date();
  const model = image.model || DEFAULT_IMAGE_MODEL;
  const jobId = `job_${randomUUID()}`;
  const inputUrls = cleanStringList(image.input_urls || []);
  const parts = [{ text: image.prompt }];

  for (const url of inputUrls) {
    const file = await downloadUrl(url, {
      maxBytes: context.config.maxDownloadBytes,
      fetchImpl: context.fetchImpl
    });
    parts.push(toInlineDataPart(file));
  }

  const raw = await geminiJson(
    `/models/${model}:generateContent`,
    {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["Image"],
        responseFormat: {
          image: {
            aspectRatio: image.aspect_ratio || "1:1",
            imageSize: normalizeImageSize(image.resolution)
          }
        }
      }
    },
    context
  );

  const imagePart = findInlinePart(raw, "image/");
  if (!imagePart?.data) {
    throw new HttpError(502, "Gemini не вернул изображение в base64.", redactInlineData(raw));
  }

  const mimeType = imagePart.mimeType || "image/png";
  const stored = await createStoredFile({
    buffer: Buffer.from(imagePart.data, "base64"),
    mimeType,
    extension: extensionFromMime(mimeType),
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
    raw: redactInlineData(raw)
  });
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
  const model = audio.model || DEFAULT_TRANSCRIBE_MODEL;
  const file = await downloadUrl(audio.audio_url, {
    maxBytes: context.config.maxDownloadBytes,
    fetchImpl: context.fetchImpl
  });

  const raw = await transcribeBuffer({
    buffer: file.buffer,
    mimeType: file.mimeType,
    model,
    language: audio.language,
    prompt: audio.prompt,
    timestamps: isTruthy(audio.timestamps),
    context
  });

  return shapeTranscriptionResponse({ model, raw });
}

async function textToSpeech(audio, context) {
  const model = audio.model || DEFAULT_TTS_MODEL;
  const speed = normalizeOptionalNumber(audio.speed) ?? 1;
  const text = applySpeedInstruction(buildTtsPrompt(audio), speed);
  const raw = await geminiJson(
    `/models/${model}:generateContent`,
    {
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: audio.voice || "Kore"
            }
          }
        }
      }
    },
    context
  );

  const audioPart = findInlinePart(raw, "audio/");
  if (!audioPart?.data) {
    throw new HttpError(502, "Gemini не вернул аудио в base64.", redactInlineData(raw));
  }

  const pcm = Buffer.from(audioPart.data, "base64");
  const wav = pcmToWav(pcm);
  const transcription = isTruthy(audio.tts_timestamps)
    ? await transcribeBuffer({
        buffer: wav,
        mimeType: "audio/wav",
        model: DEFAULT_TRANSCRIBE_MODEL,
        language: audio.language,
        prompt: "Расшифруй это аудио для субтитров.",
        timestamps: true,
        context
      })
    : null;

  const stored = await createStoredFile({
    buffer: wav,
    mimeType: "audio/wav",
    extension: "wav",
    filesDir: context.config.filesDir,
    publicBaseUrl: context.config.publicBaseUrl,
    ttlMs: context.config.fileTtlMs
  });

  return shapeTtsResponse({
    model,
    voice: audio.voice || "Kore",
    speed,
    transcription: transcription ? shapeTranscriptionResponse({ model: DEFAULT_TRANSCRIBE_MODEL, raw: transcription }) : null,
    audio: stored,
    raw: {
      response: redactInlineData(raw),
      subtitle_transcription: transcription || null
    }
  });
}

async function transcribeBuffer({ buffer, mimeType, model, language, prompt, timestamps, context }) {
  const instruction = timestamps
    ? [
        prompt || "Расшифруй аудио.",
        "Верни только JSON по схеме. start и end указывай в секундах.",
        "segments должны подходить для субтитров SRT/VTT. words можно вернуть пустым массивом, если точные слова недоступны."
      ].join(" ")
    : prompt || "Расшифруй аудио в текст.";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: language ? `${instruction} Язык: ${language}.` : instruction },
          {
            inline_data: {
              mime_type: mimeType,
              data: buffer.toString("base64")
            }
          }
        ]
      }
    ]
  };

  if (timestamps) {
    body.generationConfig = {
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: subtitleSchema()
        }
      }
    };
  }

  const raw = await geminiJson(`/models/${model}:generateContent`, body, context);
  const text = extractGeminiText(raw);

  if (!timestamps) {
    return { text, segments: [], words: [], raw };
  }

  const parsed = parseJsonOrNull(text) || {};
  return {
    text: parsed.text || text,
    segments: normalizeSegments(parsed.segments),
    words: normalizeWords(parsed.words),
    raw
  };
}

async function geminiJson(path, body, context) {
  const response = await context.fetchImpl(`${context.config.geminiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      ...geminiHeaders(context.geminiApiKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(stripUndefined(body))
  });

  const text = await response.text();
  if (!response.ok) {
    await throwGeminiError(response, text);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "Gemini вернул не-JSON ответ.", text);
  }
}

async function throwGeminiError(response, knownText = null) {
  const text = knownText ?? (await response.text());
  let details = text;
  let message = `Gemini API вернул ошибку ${response.status}.`;

  try {
    const parsed = JSON.parse(text);
    details = parsed;
    message = parsed.error?.message || message;
  } catch {
    // Keep raw text.
  }

  throw new HttpError(response.status, message, details);
}

function geminiHeaders(apiKey) {
  return { "x-goog-api-key": apiKey };
}

function toInlineDataPart(file) {
  return {
    inline_data: {
      mime_type: file.mimeType,
      data: file.buffer.toString("base64")
    }
  };
}

function findInlinePart(raw, mimePrefix) {
  for (const candidate of raw.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      const mimeType = inline?.mimeType || inline?.mime_type || "";
      if (inline?.data && mimeType.startsWith(mimePrefix)) {
        return { data: inline.data, mimeType };
      }
    }
  }
  return null;
}

function extractGeminiText(raw) {
  const parts = [];
  for (const candidate of raw.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("");
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

function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text || part.content || "")
      .filter(Boolean)
      .join("\n");
  }
  return String(content || "");
}

function normalizeGeminiRole(role) {
  return role === "assistant" || role === "model" ? "model" : "user";
}

function normalizeFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description || "",
    parameters: tool.parameters || {
      type: "object",
      properties: {},
      required: []
    }
  };
}

function mapThinkingLevel(value) {
  if (value === "high") return "high";
  if (value === "low" || value === "minimal") return "low";
  return "medium";
}

function normalizeImageSize(value) {
  if (value === "512" || value === "1K" || value === "2K" || value === "4K") return value;
  return "1K";
}

function applySpeedInstruction(text, speed) {
  if (speed <= 0.7) return `[very slow] ${text}`;
  if (speed < 0.95) return `[slow] ${text}`;
  if (speed >= 1.5) return `[very fast] ${text}`;
  if (speed > 1.05) return `[fast] ${text}`;
  return text;
}

function buildTtsPrompt(audio) {
  const instructions = String(audio.instructions || "").trim();
  if (!instructions) return audio.text;
  return `${instructions}\n\nОзвучь этот текст:\n${audio.text}`;
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function subtitleSchema() {
  return {
    type: "object",
    properties: {
      text: { type: "string" },
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            start: { type: "number" },
            end: { type: "number" },
            speaker: { type: "string" },
            text: { type: "string" }
          },
          required: ["start", "end", "text"]
        }
      },
      words: {
        type: "array",
        items: {
          type: "object",
          properties: {
            word: { type: "string" },
            start: { type: "number" },
            end: { type: "number" }
          },
          required: ["word", "start", "end"]
        }
      }
    },
    required: ["text", "segments", "words"]
  };
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map((segment, index) => ({
    id: Number(segment.id ?? index + 1),
    start: Number(segment.start ?? 0),
    end: Number(segment.end ?? segment.start ?? 0),
    speaker: segment.speaker || "",
    text: String(segment.text || "")
  }));
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words.map((word) => ({
    word: String(word.word || word.text || ""),
    start: Number(word.start ?? 0),
    end: Number(word.end ?? word.start ?? 0)
  }));
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

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactInlineData(raw) {
  return {
    ...raw,
    candidates: (raw.candidates || []).map((candidate) => ({
      ...candidate,
      content: {
        ...candidate.content,
        parts: (candidate.content?.parts || []).map((part) => {
          const inline = part.inlineData || part.inline_data;
          if (!inline?.data) return part;
          return {
            ...part,
            inlineData: {
              mimeType: inline.mimeType || inline.mime_type,
              data: "[base64 omitted]"
            },
            inline_data: undefined
          };
        })
      }
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
