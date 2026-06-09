export function shapeTranscriptionResponse({ model, raw }) {
  const segments = Array.isArray(raw.segments) ? raw.segments : [];
  const words = Array.isArray(raw.words) ? raw.words : [];

  return {
    operation: "audio",
    audio_operation: "transcribe",
    model,
    text: raw.text || "",
    srt: buildSrt(segments),
    vtt: buildVtt(segments),
    segments,
    words,
    raw
  };
}

export function buildSrt(segments) {
  return segments
    .map((segment, index) => {
      return [
        String(index + 1),
        `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}`,
        String(segment.text || "").trim()
      ].join("\n");
    })
    .join("\n\n");
}

export function buildVtt(segments) {
  const body = segments
    .map((segment) => {
      return [
        `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}`,
        String(segment.text || "").trim()
      ].join("\n");
    })
    .join("\n\n");

  return `WEBVTT\n\n${body}`;
}

function formatSrtTime(seconds) {
  return formatTime(seconds, ",");
}

function formatVttTime(seconds) {
  return formatTime(seconds, ".");
}

function formatTime(value, separator) {
  const totalMs = Math.max(0, Math.round(Number(value || 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${String(ms).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
