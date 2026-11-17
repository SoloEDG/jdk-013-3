import { reactive, readonly } from "vue";
import { soundSources } from "../../../shared/content";
import type { Camera, SoundSourceConfig } from "../../../shared/types";
import { watchOutputDevices } from "../lib/devices";
import { BellProducer, LoopProducer, type Producer } from "../lib/producers";
import {
  angularDelta,
  attentionFactor,
  inWindow,
  listenerOrientation,
  sourceVector,
} from "../lib/spatial";
import { buildProceduralBuffer } from "../lib/synthesis";
import { createSpeech, type Speech } from "../lib/speech";

export type EnginePhase = "locked" | "ready" | "suspended" | "no-output" | "unsupported";
export type LoadState = "idle" | "loading" | "ready" | "error";
export type SourceState = "off" | "loading" | "sounding" | "muted-slot" | "out-of-window";

export interface SourceStatus {
  id: string;
  label: string;
  kind: SoundSourceConfig["kind"];
  state: SourceState;
  load: LoadState;
  error: string;
  /** 0~1 的实时响度，用于界面指示与真实播放保持一致 */
  level: number;
}

export interface SoundView {
  chapterId: string;
  time: number;
  camera: Camera;
  playing: boolean;
  muted: boolean;
  inInterview: boolean;
}

const MAX_VOICES = 4;
const KEEP_ALIVE_MS = 1500;
const SCENE_DUCK = 0.18; // 访谈期间保留的轻微现场声
const PAUSE_DUCK = 0.25; // 暂停时的低鸣
const RADIUS = 5;

interface Runtime {
  config: SoundSourceConfig;
  load: LoadState;
  error: string;
  buffer: AudioBuffer | undefined;
  panner: PannerNode | undefined;
  level: GainNode | undefined;
  producer: Producer | undefined;
  state: SourceState;
  lastLevel: number;
  lastArmedAt: number;
}

export function createSpatialEngine() {
  const status = reactive({
    phase: "locked" as EnginePhase,
    unlocked: false,
    muted: false,
    deviceNote: "",
    sources: soundSources.map<SourceStatus>((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      state: "off",
      load: "idle",
      error: "",
      level: 0,
    })),
  });

  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let sceneBus: GainNode | undefined;
  let speechBus: GainNode | undefined;
  let raf = 0;
  let stopWatching: (() => void) | undefined;
  let speech: Speech | undefined;
  let view: SoundView = {
    chapterId: soundSources[0]!.chapterId,
    time: 0,
    camera: { yaw: 0, pitch: 0, fov: 70 },
    playing: false,
    muted: false,
    inInterview: false,
  };

  const runtimes = new Map<string, Runtime>(
    soundSources.map((config) => [
      config.id,
      {
        config,
        load: "idle",
        error: "",
        buffer: undefined,
        panner: undefined,
        level: undefined,
        producer: undefined,
        state: "off",
        lastLevel: 0,
        lastArmedAt: 0,
      },
    ]),
  );
  const statusOf = (id: string) => status.sources.find((s) => s.id === id)!;
  const runtimeOf = (id: string) => runtimes.get(id)!;

  function createContext(): boolean {
    if (ctx) return true;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) {
      status.phase = "unsupported";
      return false;
    }
    ctx = new AC();
    master = ctx.createGain();
    sceneBus = ctx.createGain();
    speechBus = ctx.createGain();
    sceneBus.connect(master);
    speechBus.connect(master);
    master.connect(ctx.destination);
    speech = createSpeech(() => ctx, () => speechBus);
    return true;
  }

  async function unlock() {
    if (!createContext() || !ctx || !master) return;
    try {
      await ctx.resume();
    } catch {
      status.phase = "suspended";
      return;
    }
    if (!status.unlocked) {
      status.unlocked = true;
      startLoop();
      stopWatching = watchOutputDevices((s) => {
        status.deviceNote = s.disconnected
          ? s.hasOutput
            ? "耳机已断开，正在使用扬声器"
            : "未检测到音频输出设备"
          : "音频输出已恢复";
        status.phase = s.hasOutput ? "ready" : "no-output";
        if (s.hasOutput && ctx?.state === "suspended") void ctx.resume();
      });
      document.addEventListener("visibilitychange", onVisibility);
    }
    status.phase = ctx.state === "running" ? "ready" : "suspended";
    reconcile();
  }

  function onVisibility() {
    if (document.hidden) return;
    if (ctx && status.unlocked && ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (ctx && ctx.state === "running" && status.phase !== "no-output")
          status.phase = "ready";
      });
    }
  }

  // ---- 素材加载（真实 fetch 解码 / 程序化合成都经过同一状态机） ----
  async function loadSource(rt: Runtime): Promise<AudioBuffer | undefined> {
    if (!ctx) return undefined;
    if (rt.buffer) return rt.buffer;
    const ui = statusOf(rt.config.id);
    rt.load = "loading";
    ui.load = "loading";
    ui.error = "";
    try {
      if (rt.config.src) {
        const res = await fetch(rt.config.src, { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        rt.buffer = await ctx.decodeAudioData(arr);
      } else {
        // 程序化合成放入微任务，模拟素材"到场"的异步过程，状态机完全一致。
        rt.buffer = await Promise.resolve().then(() =>
          buildProceduralBuffer(ctx!, rt.config.kind),
        );
      }
      rt.load = "ready";
      ui.load = "ready";
      return rt.buffer;
    } catch {
      rt.load = "error";
      ui.load = "error";
      rt.error = "声音素材加载失败";
      ui.error = rt.error;
      return undefined;
    }
  }

  async function retry(id: string) {
    const rt = runtimeOf(id);
    rt.buffer = undefined;
    rt.load = "idle";
    if (rt.config.src) {
      // 真实素材失败后绕过缓存重试一次
      try {
        const res = await fetch(`${rt.config.src}?retry=${Date.now()}`);
        if (res.ok && ctx) {
          const arr = await res.arrayBuffer();
          rt.buffer = await ctx.decodeAudioData(arr);
          rt.load = "ready";
          statusOf(id).load = "ready";
          statusOf(id).error = "";
          rt.error = "";
        } else {
          throw new Error("retry failed");
        }
      } catch {
        rt.load = "error";
        statusOf(id).load = "error";
        statusOf(id).error = "重试失败，请检查网络";
        rt.error = statusOf(id).error;
      }
    } else {
      await loadSource(rt);
    }
    reconcile();
  }

  // ---- 发声体装配 / 拆除 ----
  function arm(rt: Runtime) {
    if (!ctx || !sceneBus || !rt.buffer) return;
    const [x, y, z] = sourceVector(rt.config);
    const panner = ctx.createPanner();
    if (panner.positionX) {
      panner.positionX.value = x * RADIUS;
      panner.positionY.value = y * RADIUS;
      panner.positionZ.value = z * RADIUS;
    } else {
      panner.setPosition(x * RADIUS, y * RADIUS, z * RADIUS);
    }
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.2;
    panner.maxDistance = 14;
    panner.rolloffFactor = 1.1;

    const level = ctx.createGain();
    level.gain.value = 0.0001;
    level.connect(panner).connect(sceneBus);

    const nodes = { output: panner, level };
    if (rt.config.kind === "bell") {
      rt.producer = new BellProducer(ctx, nodes, rt.config, view.time);
    } else {
      rt.producer = new LoopProducer(ctx, rt.buffer, nodes, rt.config, view.time);
    }
    rt.panner = panner;
    rt.level = level;
    rt.state = "sounding";
    rt.lastArmedAt = performance.now();
    statusOf(rt.config.id).state = "sounding";
  }

  function disarm(rt: Runtime, state: SourceState) {
    const audio = ctx;
    if (rt.level && audio) {
      // 淡出再停，避免咔哒声与反复截断的突兀感
      rt.level.gain.cancelScheduledValues(audio.currentTime);
      rt.level.gain.setValueAtTime(rt.level.gain.value, audio.currentTime);
      rt.level.gain.linearRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    }
    const producer = rt.producer;
    window.setTimeout(() => {
      producer?.dispose();
      rt.panner?.disconnect();
      rt.level?.disconnect();
    }, 160);
    rt.producer = undefined;
    rt.panner = undefined;
    rt.level = undefined;
    rt.state = state;
    statusOf(rt.config.id).state = state;
    statusOf(rt.config.id).level = 0;
    rt.lastLevel = 0;
  }

  // ---- 时间窗 / 声部上限的统一仲裁 ----
  function reconcile() {
    if (!ctx || !status.unlocked) return;
    const eligible: Runtime[] = [];
    for (const rt of runtimes.values()) {
      const ui = statusOf(rt.config.id);
      const inChapter = rt.config.chapterId === view.chapterId;
      const within = inChapter && inWindow(rt.config, view.time);

      if (!inChapter) {
        if (rt.producer) disarm(rt, "off");
        else rt.state = ui.state = "off";
        continue;
      }
      if (!within) {
        if (rt.producer) disarm(rt, "out-of-window");
        else rt.state = ui.state = "out-of-window";
        continue;
      }
      eligible.push(rt);
    }

    // 优先级排序：人物故事优先；同级时距离屏幕中心更近者优先
    const score = (rt: Runtime) => {
      const d = angularDelta(rt.config, view.camera);
      return rt.config.priority * 1000 - (Math.abs(d.yaw) + Math.abs(d.pitch));
    };
    eligible.sort((a, b) => score(b) - score(a));

    // 正在加载（素材迟到）的声源先排队，不占正式声部，到场后再参加仲裁
    const pending = eligible.filter((rt) => rt.load === "loading");
    pending.forEach((rt) => (rt.state = statusOf(rt.config.id).state = "loading"));

    // 可参加声部分配的声源：已发声、已就绪，或尚未开始加载（将在选中后加载）
    const candidates = eligible.filter((rt) => rt.load !== "loading");
    // 刚响起的声音受保护，避免连续转头导致反复截断
    const protectedIds = new Set(
      candidates
        .filter(
          (rt) =>
            rt.producer && performance.now() - rt.lastArmedAt < KEEP_ALIVE_MS,
        )
        .map((rt) => rt.config.id),
    );
    const chosen = new Set<Runtime>();
    for (const rt of candidates) {
      if (rt.producer) chosen.add(rt);
      else if (chosen.size < MAX_VOICES) chosen.add(rt);
      else {
        // 声部已满：只允许高优先级故事替换未受保护的最低分发声体
        const victim = [...chosen]
          .filter((s) => s.producer && !protectedIds.has(s.config.id))
          .sort((a, b) => score(a) - score(b))[0];
        if (victim && score(rt) > score(victim)) {
          chosen.delete(victim);
          chosen.add(rt);
        }
      }
    }

    for (const rt of candidates) {
      const ui = statusOf(rt.config.id);
      if (chosen.has(rt)) {
        if (!rt.producer) void ensureArmed(rt);
        else rt.state = ui.state = "sounding";
      } else if (rt.producer) {
        disarm(rt, "muted-slot");
      } else {
        rt.state = ui.state = "muted-slot";
      }
    }

    // 被挤出窗口或章节的声源不再标记 muted-slot
    for (const rt of runtimes.values()) {
      if (!eligible.includes(rt) && rt.state === "muted-slot") {
        rt.state = statusOf(rt.config.id).state = "out-of-window";
      }
    }
  }

  async function ensureArmed(rt: Runtime) {
    const buffer = await loadSource(rt);
    if (!buffer) return;
    // 加载是异步的：素材"迟到"期间用户可能已离开时间窗，以落点状态为准
    const stillValid =
      rt.config.chapterId === view.chapterId && inWindow(rt.config, view.time);
    if (!stillValid) {
      rt.state = statusOf(rt.config.id).state = "out-of-window";
      return;
    }
    if (!rt.producer) {
      arm(rt);
      // 素材到场后重新仲裁，让迟到声源参加声部名额分配
      reconcile();
    }
  }

  // ---- 每帧：聆听者方位、距离响度、状态同步 ----
  function startLoop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!ctx || !master || !sceneBus) return;

      if (ctx.listener.positionX) {
        ctx.listener.positionX.value = 0;
        ctx.listener.positionY.value = 0;
        ctx.listener.positionZ.value = 0;
      } else if (ctx.listener.setPosition) {
        ctx.listener.setPosition(0, 0, 0);
      }
      const { forward, up } = listenerOrientation(view.camera);
      if (ctx.listener.forwardX) {
        ctx.listener.forwardX.value = forward[0];
        ctx.listener.forwardY.value = forward[1];
        ctx.listener.forwardZ.value = forward[2];
        ctx.listener.upX.value = up[0];
        ctx.listener.upY.value = up[1];
        ctx.listener.upZ.value = up[2];
      } else if (ctx.listener.setOrientation) {
        ctx.listener.setOrientation(
          forward[0], forward[1], forward[2],
          up[0], up[1], up[2],
        );
      }

      const duck = view.inInterview ? SCENE_DUCK : view.playing ? 1 : PAUSE_DUCK;
      const targetMaster = status.muted ? 0.0001 : 1;
      master.gain.setTargetAtTime(targetMaster, ctx.currentTime, 0.05);
      sceneBus.gain.setTargetAtTime(duck, ctx.currentTime, 0.12);

      let active = 0;
      for (const rt of runtimes.values()) {
        const ui = statusOf(rt.config.id);
        if (rt.producer && rt.level) {
          const attention = attentionFactor(rt.config, view.camera);
          const g = Math.min(1, attention) * duck;
          rt.level.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
          rt.lastLevel = g;
          ui.level = Math.round(g * 100) / 100;
          active++;
        } else {
          ui.level = 0;
        }
      }
      if (active === 0 && status.phase === "ready" && ctx.state === "suspended") {
        status.phase = "suspended";
      } else if (active > 0 && status.phase === "suspended" && ctx.state === "running") {
        status.phase = "ready";
      }
    };
    raf = requestAnimationFrame(tick);
  }

  // ---- 对外视图与时间线控制 ----
  function setCamera(camera: Camera) {
    view = { ...view, camera: { ...camera } };
  }
  function setMuted(muted: boolean) {
    status.muted = muted;
    view = { ...view, muted };
  }
  function setInterview(inInterview: boolean) {
    view = { ...view, inInterview };
    if (!inInterview) speech?.stop();
    reconcile();
  }
  function updatePlayback(chapterId: string, time: number, playing: boolean) {
    const chapterChanged = chapterId !== view.chapterId;
    view = { ...view, chapterId, time, playing };
    if (chapterChanged) {
      // 切章：全部声源按新章节重建，绝不叠加
      for (const rt of runtimes.values()) if (rt.producer) disarm(rt, "off");
    }
    reconcile();
  }

  /**
   * 时间线跳转（拖动/收藏回访）：以落点为准恢复。
   * 拖动过程中只更新视角与时间，不重排声部；松手或点击落点后一次仲裁。
   */
  function scrubTo(chapterId: string, time: number) {
    view = { ...view, chapterId, time };
  }
  function land(chapterId: string, time: number, playing: boolean) {
    const chapterChanged = chapterId !== view.chapterId;
    view = { ...view, chapterId, time, playing };
    if (chapterChanged) {
      for (const rt of runtimes.values()) if (rt.producer) disarm(rt, "off");
    }
    // 仍在发声的循环素材对齐落点时间；钟声按落点重新排程
    for (const rt of runtimes.values()) {
      if (rt.producer) rt.producer.resync(time);
    }
    reconcile();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    stopWatching?.();
    document.removeEventListener("visibilitychange", onVisibility);
    speech?.stop();
    for (const rt of runtimes.values()) rt.producer?.dispose();
    void ctx?.close();
  }

  return {
    status: readonly(status),
    unlock,
    retry,
    setCamera,
    setMuted,
    setInterview,
    updatePlayback,
    scrubTo,
    land,
    dispose,
    getSpeech: () => speech,
    isUnlocked: () => status.unlocked,
  };
}

export type SpatialEngine = ReturnType<typeof createSpatialEngine>;
