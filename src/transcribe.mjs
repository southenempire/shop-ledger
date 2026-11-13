import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

// Telegram voice notes are OGG/Opus; Whisper wants 16 kHz mono WAV.
export async function toWav(input) {
  const out = path.join(os.tmpdir(), `shop-ledger-${process.pid}-${Date.now()}.wav`);
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('ffmpeg not found. Install it (macOS: brew install ffmpeg).');
    throw new Error(`ffmpeg could not read ${input}: ${err.stderr?.trim() || err.message}`);
  }
  return out;
}

// The SDK is imported lazily so text-only commands and the tests start instantly.
export async function transcribeFile(file, { items = {}, onProgress } = {}) {
  const sdk = await import('@qvac/sdk');
  const modelName = process.env.SHOP_STT_MODEL ?? 'WHISPER_EN_SMALL_Q8_0';
  const modelSrc = sdk[modelName];
  if (!modelSrc) throw new Error(`Unknown speech model "${modelName}" in SHOP_STT_MODEL.`);

  const wav = await toWav(file);
  let modelId;
  try {
    modelId = await sdk.loadModel({
      modelSrc,
      modelType: 'whisper',
      modelConfig: { language: 'en' },
      onProgress: onProgress ? (p) => onProgress(Math.round(p.percentage ?? 0)) : undefined,
    });
    // Hint the decoder with a sentence in the shape we expect, using the shop's own items and units.
    // This helps with item names ("Indomie") and with "two cartons" being heard as "true cartoon".
    const list = Object.values(items);
    const prompt = list.length
      ? `I sold two ${list[0].unit}s of ${list[0].name} and three ${list[1]?.unit ?? list[0].unit}s of ${list[1]?.name ?? list[0].name}. Items: ${list.map((i) => i.name).join(', ')}.`
      : undefined;
    const text = await sdk.transcribe({ modelId, audioChunk: wav, prompt });
    return String(text).trim();
  } finally {
    // Unload before anything else loads: the target machine may only have 8 GB of RAM.
    if (modelId) await sdk.unloadModel({ modelId, clearStorage: false }).catch(() => {});
    await rm(wav, { force: true });
  }
}

export async function shutdownSdk() {
  const sdk = await import('@qvac/sdk');
  await sdk.close();
}
