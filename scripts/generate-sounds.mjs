// 生成演示用的环境音素材（真实的网络可加载音频，用于解码/迟到/失败/重试链路）。
// 运行：node scripts/generate-sounds.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sampleRate = 22050;
const duration = 8; // 秒，循环素材
const length = sampleRate * duration;

function writeWav(path, samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return writeFile(path, Buffer.from(buffer));
}

// 船声：低频引擎嗡鸣 + 周期性水波，首尾同相位保证可无缝循环。
const boat = new Float32Array(length);
for (let i = 0; i < length; i++) {
  const t = i / sampleRate;
  const engine =
    0.5 * Math.sin(2 * Math.PI * 55 * t) +
    0.28 * Math.sin(2 * Math.PI * 110 * t) +
    0.12 * Math.sin(2 * Math.PI * 165 * t);
  const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * (1 / 3.2) * t);
  const wave =
    0.22 *
    swell *
    (Math.sin(2 * Math.PI * 0.9 * t) + 0.5 * Math.sin(2 * Math.PI * 1.7 * t + 1.3));
  boat[i] = 0.55 * engine + wave;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "media", "audio");
await mkdir(out, { recursive: true });
await writeWav(join(out, "boat-ambience.wav"), boat);
console.log("wrote public/media/audio/boat-ambience.wav");
