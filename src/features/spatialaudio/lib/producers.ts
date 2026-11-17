import type { SoundSourceConfig } from "../../../shared/types";

export interface Producer {
  /** 时间线跳转后对齐到新的章节时间 */
  resync(time: number): void;
  dispose(): void;
}

interface ProducerNodes {
  output: AudioNode;
  level: GainNode;
}

/** 循环素材（船声、人声、刨木声）：按章节时间计算偏移，跳转时重建以对齐落点。 */
export class LoopProducer implements Producer {
  private source: AudioBufferSourceNode | undefined;

  constructor(
    private ctx: AudioContext,
    private buffer: AudioBuffer,
    private nodes: ProducerNodes,
    private config: SoundSourceConfig,
    startTime: number,
  ) {
    this.start(startTime);
  }

  private start(time: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    const offset =
      this.buffer.duration > 0
        ? Math.max(0, time - this.config.start) % this.buffer.duration
        : 0;
    src.connect(this.nodes.level);
    src.start(0, offset);
    this.source = src;
  }

  resync(time: number) {
    const old = this.source;
    old?.stop(this.ctx.currentTime);
    old?.disconnect();
    this.start(time);
  }

  dispose() {
    try {
      this.source?.stop(this.ctx.currentTime);
    } catch {
      /* 已停止则忽略 */
    }
    this.source?.disconnect();
    this.source = undefined;
  }
}

/** 钟声：按固定周期调度一次次钟鸣，时间线跳转后按落点重新排程。 */
export class BellProducer implements Producer {
  private timers: number[] = [];
  private readonly period: number;
  private readonly base = 523.25; // C5

  constructor(
    private ctx: AudioContext,
    private nodes: ProducerNodes,
    private config: SoundSourceConfig,
    startTime: number,
  ) {
    this.period = config.period ?? 3.5;
    this.schedule(startTime);
  }

  /** 下一次钟鸣距离章节起点的时间。 */
  private nextStrike(from: number): number {
    const local = Math.max(0, from - this.config.start);
    return this.config.start + (Math.floor(local / this.period) + 1) * this.period;
  }

  private schedule(from: number) {
    let strikeAt = this.nextStrike(from);
    // 预排未来两次钟鸣，保证节奏稳定又不积压过多定时器。
    while (strikeAt < this.config.end && this.timers.length < 2) {
      const chapterTime = strikeAt;
      const delay = Math.max(0.05, chapterTime - from);
      const timer = window.setTimeout(() => this.strike(), delay * 1000);
      this.timers.push(timer);
      strikeAt += this.period;
    }
  }

  private strike() {
    this.timers.shift();
    const now = this.ctx.currentTime;
    const partials: Array<[number, number]> = [
      [1, 0.5],
      [2.01, 0.28],
      [2.72, 0.18],
      [4.16, 0.1],
    ];
    partials.forEach(([ratio, gain], idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = this.base * ratio;
      osc.detune.value = (idx - 1.5) * 4;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      osc.connect(g).connect(this.nodes.level);
      osc.start(now);
      osc.stop(now + 2.5);
      osc.onended = () => {
        g.disconnect();
        osc.disconnect();
      };
    });
  }

  resync(time: number) {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    if (time < this.config.end) this.schedule(time);
  }

  dispose() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
