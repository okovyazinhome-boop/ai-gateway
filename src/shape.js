export function shapeChatResponse(raw) {
  const text = extractText(raw);
  return {
    operation: "chat",
    id: raw.id || null,
    role: extractRole(raw) || "assistant",
    model: raw.model || null,
    text,
    finish_reason: raw.status || extractFinishReason(raw) || null,
    usage: normalizeUsage(raw.usage || raw.usageMetadata),
    tool_calls: extractToolCalls(raw),
    parsed_json: parseJsonOrNull(text),
    reasoning: extractReasoning(raw),
    raw
  };
}

export function shapeImageResponse({ model, jobId, startedAt, completedAt, image, raw }) {
  return {
    operation: "image",
    model,
    status: "success",
    job_id: jobId,
    duration_seconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    image_url: image.url,
    image_urls: [image.url],
    file_name: image.fileName,
    mime_type: image.mimeType,
    created_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    expires_at: image.expiresAt.toISOString(),
    raw
  };
}

export function shapeTtsResponse({ model, voice, speed, audio, transcription = null, raw }) {
  return {
    operation: "audio",
    audio_operation: "tts",
    model,
    voice,
    speed,
    text: transcription?.text || null,
    srt: transcription?.srt || "",
    vtt: transcription?.vtt || "",
    segments: transcription?.segments || [],
    words: transcription?.words || [],
    audio_url: audio.url,
    file_name: audio.fileName,
    mime_type: audio.mimeType,
    expires_at: audio.expiresAt.toISOString(),
    raw
  };
}

function extractText(raw) {
  if (Array.isArray(raw.candidates)) {
    return raw.candidates
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("");
  }

  if (typeof raw.output_text === "string") {
    return raw.output_text;
  }

  const parts = [];
  for (const item of raw.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("");
}

function extractRole(raw) {
  for (const candidate of raw.candidates || []) {
    if (candidate.content?.role) return candidate.content.role;
  }

  for (const item of raw.output || []) {
    if (item.role) return item.role;
  }
  return null;
}

function extractFinishReason(raw) {
  for (const candidate of raw.candidates || []) {
    if (candidate.finishReason) return candidate.finishReason;
  }

  for (const item of raw.output || []) {
    if (item.status) return item.status;
  }
  return null;
}

function normalizeUsage(usage = {}) {
  if (usage.promptTokenCount || usage.candidatesTokenCount || usage.totalTokenCount) {
    return {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)
    };
  }

  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: usage.total_tokens ?? input + output
  };
}

function extractToolCalls(raw) {
  if (Array.isArray(raw.candidates)) {
    return raw.candidates
      .flatMap((candidate) => candidate.content?.parts || [])
      .filter((part) => part.functionCall)
      .map((part) => part.functionCall);
  }

  return (raw.output || []).filter((item) => {
    return item.type && (item.type.includes("tool") || item.type === "function_call");
  });
}

function extractReasoning(raw) {
  const reasoning = (raw.output || []).find((item) => item.type === "reasoning");
  return reasoning?.summary || reasoning?.content || null;
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
