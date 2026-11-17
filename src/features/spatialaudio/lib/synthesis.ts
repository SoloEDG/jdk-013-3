import type { SoundKind } from "../../../shared/types";

const PROCEDURAL_RATE = 22050;

/**
 * 程序化合成循环素材：无需任何音频文件，也能在解锁后立即得到
 * 有明确音色的环境声；真实素材（船声）则走 fetch + decodeAudioData。
 */
export function buildProceduralBuffer(
  ctx: BaseAudioContext,
  kind: SoundKind,
): AudioBuffer {
  const seconds = kind === "voice" ? 2.4 : 4;
  const length = Math.round(PROCEDURAL_RATE * seconds);
  const buffer = ctx.createBuffer(1, length, PROCEDURAL_RATE);
  const data = buffer.getChannelData(0);

  if (kind === "voice") fillVoice(data, seconds);
  else if (kind === "tool") fillTools(data, seconds);
  else fillWind(data, seconds);

  // 首尾等功率交叉淡化，避免循环接缝产生爆音。
  const fade = Math.min(length >> 4, PROCEDURAL_RATE * 0.03);
  for (let i = 0; i < fade; i++) {
    const a = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    data[i] *= a;
    data[length - 1 - i] *= a;
  }
  return buffer;
}

/** 人物现场声：共振峰 + 语速起伏，模拟"听不清字句但有方位的人声"。 */
function fillVoice(data: Float32Array, seconds: number) {
  const formants = [320, 780, 2400];
  for (let i = 0; i < data.length; i++) {
    const t = i / PROCEDURAL_RATE;
    // 说话节奏：约 4 个音节/秒的振幅包络
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.8 * t);
    const breath = 0.75 + 0.25 * Math.sin(2 * Math.PI * (1 / seconds) * t);
    let v = 0;
    formants.forEach((f, idx) => {
      const wobble = 1 + 0.004 * Math.sin(2 * Math.PI * (5.1 + idx) * t);
      v += (1 / (idx + 1)) * 0.5 * Math.sin(2 * Math.PI * f * wobble * t);
    });
    data[i] = 0.32 * v * (0.25 + 0.75 * syllable) * breath;
  }
}

/** 刨木声：带通噪声 + 推拉节奏的短促刮擦。 */
function fillTools(data: Float32Array, seconds: number) {
  let last = 0;
  const strokes = Math.round(seconds * 1.1);
  for (let i = 0; i < data.length; i++) {
    const t = i / PROCEDURAL_RATE;
    const phase = (t * strokes) / seconds;
    const stroke = Math.max(0, Math.sin(2 * Math.PI * phase));
    const white = Math.random() * 2 - 1;
    last = last * 0.72 + white * 0.28; // 低通，模拟木头的闷响
    data[i] = 0.5 * last * stroke ** 2;
  }
}

/** 夜风声：缓慢起伏的滤波噪声底。 */
function fillWind(data: Float32Array, seconds: number) {
  let lp = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / PROCEDURAL_RATE;
    const white = Math.random() * 2 - 1;
    lp = lp * 0.985 + white * 0.015;
    const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * (1 / seconds) * t);
    data[i] = 0.6 * lp * gust;
  }
}
