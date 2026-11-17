import { reactive } from "vue";

export type SpeechMode = "tts" | "ambient" | "stopped";

export interface SpeechState {
  mode: SpeechMode;
  paragraph: number;
  supported: boolean;
  error: string;
}

/**
 * 访谈讲话：优先使用系统语音合成（TTS，保证人物讲话清晰），
 * 不可用时回退到 Web Audio 的程序化人声（仍能表达"有人在说话"）。
 * 与现场声总线分离，访谈期间现场声被压低而讲话不受影响。
 */
export function createSpeech(ctx: () => AudioContext | undefined, bus: () => GainNode | undefined) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const state = reactive<SpeechState>({
    mode: "stopped",
    paragraph: 0,
    supported,
    error: "",
  });

  let fallback: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | undefined;
  let voicesReady = false;
  let utterToken = 0;

  function pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return undefined;
    return (
      voices.find((v) => /zh(-|_)?(CN|Hans)/i.test(v.lang)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
      voices.find((v) => /chinese|mandarin/i.test(v.name)) ||
      voices[0]
    );
  }

  function ensureVoices(): Promise<void> {
    if (voicesReady || !supported) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        voicesReady = true;
        resolve();
      };
      if (window.speechSynthesis.getVoices().length) done();
      else {
        window.speechSynthesis.onvoiceschanged = () => done();
        setTimeout(done, 800); // 部分浏览器不触发事件
      }
    });
  }

  function stopFallback() {
    if (!fallback) return;
    const { osc, gain, lfo } = fallback;
    const audio = ctx();
    if (audio) gain.gain.linearRampToValueAtTime(0.0001, audio.currentTime + 0.15);
    window.setTimeout(() => {
      try {
        osc.stop();
        lfo.stop();
      } catch {
        /* 已停止 */
      }
      osc.disconnect();
      gain.disconnect();
      lfo.disconnect();
    }, 220);
    fallback = undefined;
  }

  function startFallback() {
    const audio = ctx();
    const target = bus();
    if (!audio || !target) {
      state.error = "浏览器音频未解锁，讲话不可用";
      return;
    }
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const lfo = audio.createOscillator();
    const lfoGain = audio.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 150;
    lfo.frequency.value = 3.6; // 语速起伏
    lfoGain.gain.value = 26;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(target);
    osc.start();
    lfo.start();
    gain.gain.linearRampToValueAtTime(0.12, audio.currentTime + 0.2);
    fallback = { osc, gain, lfo };
    state.mode = "ambient";
  }

  async function speak(text: string, paragraph: number) {
    stop();
    const token = ++utterToken;
    state.paragraph = paragraph;
    state.error = "";
    await ensureVoices();
    if (token !== utterToken) return; // await 期间已被新的讲话/停止取代
    if (!supported) {
      startFallback();
      return;
    }
    try {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      } else {
        utter.lang = "zh-CN";
      }
      utter.rate = 0.95;
      utter.pitch = 1;
      utter.onerror = () => {
        // cancel() 也会触发 error，用 token 区分"真正失败"与"主动停止"
        if (token === utterToken && state.mode === "tts") startFallback();
      };
      window.speechSynthesis.speak(utter);
      if (token === utterToken) state.mode = "tts";
    } catch {
      if (token === utterToken) startFallback();
    }
  }

  function stop() {
    utterToken++;
    if (supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* 忽略 */
      }
    }
    stopFallback();
    state.mode = "stopped";
  }

  return { state, speak, stop };
}

export type Speech = ReturnType<typeof createSpeech>;
