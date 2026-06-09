import test from "node:test";
import assert from "node:assert/strict";

import { buildSrt, buildVtt, shapeTranscriptionResponse } from "../src/subtitles.js";

const segments = [
  { id: 0, start: 0, end: 1.42, speaker: "SPEAKER_00", text: "Привет." },
  { id: 1, start: 61.5, end: 63.25, text: "Это тест." }
];

test("buildSrt formats segment timestamps for subtitle tools", () => {
  assert.equal(
    buildSrt(segments),
    "1\n00:00:00,000 --> 00:00:01,420\n[SPEAKER_00] Привет.\n\n2\n00:01:01,500 --> 00:01:03,250\nЭто тест."
  );
});

test("buildVtt formats segment timestamps for web video tools", () => {
  assert.equal(
    buildVtt(segments),
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.420\n[SPEAKER_00] Привет.\n\n00:01:01.500 --> 00:01:03.250\nЭто тест."
  );
});

test("shapeTranscriptionResponse returns text, SRT, VTT, segments, words, and raw", () => {
  const raw = {
    text: "Привет. Это тест.",
    segments,
    words: [{ word: "Привет", start: 0, end: 0.8 }]
  };

  const result = shapeTranscriptionResponse({
    model: "whisper-1",
    raw
  });

  assert.equal(result.operation, "audio");
  assert.equal(result.audio_operation, "transcribe");
  assert.equal(result.model, "whisper-1");
  assert.equal(result.text, "Привет. Это тест.");
  assert.match(result.srt, /00:00:00,000 --> 00:00:01,420/);
  assert.match(result.vtt, /^WEBVTT/);
  assert.deepEqual(result.segments, segments);
  assert.deepEqual(result.words, raw.words);
  assert.equal(result.raw, raw);
});
