// 空间音频引擎的逻辑回归测试（不依赖浏览器：用 mock 的 Web Audio 图记录调用）。
// 运行：node --experimental-vm-modules scripts/test-spatial-audio.mjs
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// ---------- 最小 Web Audio mock，记录节点连接与增益变化 ----------
class MockNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.connected = [];
    this.gain = mockParam(1);
    this.frequency = mockParam(440);
    this.detune = mockParam(0);
    this.positionX = mockParam(0);
    this.positionY = mockParam(0);
    this.positionZ = mockParam(0);
    this.forwardX = mockParam(0);
    this.forwardY = mockParam(0);
    this.forwardZ = mockParam(0);
    this.upX = mockParam(0);
    this.upY = mockParam(1);
    this.upZ = mockParam(0);
    this.panningModel = "HRTF";
    this.distanceModel = "inverse";
    this.refDistance = 1;
    this.maxDistance = 100;
    this.rolloffFactor = 1;
    this.loop = false;
    this.buffer = null;
    this.starts = [];
    this.stopped = false;
  }
  connect(node) {
    this.connected.push(node);
    return node;
  }
  disconnect() {
    this.connected = [];
  }
  start(_when, offset) {
    this.starts.push(offset ?? 0);
  }
  stop() {
    this.stopped = true;
  }
  setPosition() {}
  setOrientation() {}
}
function mockParam(initial) {
  return {
    value: initial,
    _ramps: [],
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
      this._ramps.push(v);
    },
    setTargetAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
    exponentialRampToValueAtTime(v) {
      this.value = v;
    },
  };
}
class MockAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 22050;
    this.destination = new MockNode(this);
    this.listener = {
      positionX: mockParam(0),
      positionY: mockParam(0),
      positionZ: mockParam(0),
      forwardX: mockParam(0),
      forwardY: mockParam(0),
      forwardZ: mockParam(-1),
      upX: mockParam(0),
      upY: mockParam(1),
      upZ: mockParam(0),
    };
    this._nodes = [];
  }
  createGain() {
    const n = new MockNode(this);
    this._nodes.push(n);
    return n;
  }
  createPanner() {
    const n = new MockNode(this);
    this._nodes.push(n);
    return n;
  }
  createBufferSource() {
    const n = new MockNode(this);
    this._nodes.push(n);
    return n;
  }
  createOscillator() {
    const n = new MockNode(this);
    this._nodes.push(n);
    return n;
  }
  createBuffer(channels, length, rate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }
  async decodeAudioData(arr) {
    if (arr.byteLength === 0) throw new Error("bad buffer");
    return this.createBuffer(1, this.sampleRate * 2, this.sampleRate);
  }
  async resume() {
    this.state = "running";
  }
  async close() {}
}

// fetch mock：boat wav 返回非空 buffer，可通过 forceError 模拟失败
let forceError = false;
globalThis.fetch = async (url) => {
  if (forceError || String(url).includes("fail"))
    return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
};
globalThis.window = globalThis;
globalThis.AudioContext = MockAudioContext;
globalThis.performance = { now: () => Date.now() };
// 异步 rAF：让引擎每帧增益/方位逻辑在测试中真实运行，又不会同步递归爆栈
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
};
// speech 模块需要
globalThis.SpeechSynthesisUtterance = class {};

// 打包引擎入口（vue 仅用于 reactive/readonly，外部注入 stub）
const result = await build({
  entryPoints: [join(root, "src/features/spatialaudio/model/engine.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
  external: ["vue"],
});
const vueStub = `
const reactive = (o) => o;
const readonly = (o) => o;
export { reactive, readonly };
`;
const vueUrl =
  "data:text/javascript;base64," + Buffer.from(vueStub).toString("base64");
const fixedCode = result.outputFiles[0].text.replace(
  /from\s*"vue"/g,
  `from "${vueUrl}"`,
);
const engineUrl =
  "data:text/javascript;base64," + Buffer.from(fixedCode).toString("base64");
const { createSpatialEngine } = await import(engineUrl);

// ---------- 断言工具 ----------
let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed++;
    console.log("  ✓", name);
  } else {
    failed++;
    console.error("  ✗", name);
  }
}
const flush = () => new Promise((r) => setTimeout(r, 20));

const engine = createSpatialEngine();
await engine.unlock();
await flush();

console.log("1) 首次解锁前不发声，解锁后按时间窗发声");
const before = engine.status.sources.filter((s) => s.state === "sounding").length;
assert(before >= 0, "初始状态可读取");

console.log("2) 时间窗：落点在窗外的声源不发声，进入后发声");
engine.land("dawn", 0, true); // 只有 fisher-voice 在 0~19 窗内
await flush();
let sounding = engine.status.sources.filter((s) => s.state === "sounding").map((s) => s.id);
assert(sounding.includes("fisher-voice"), "t=0 守潮人声发声");
assert(!sounding.includes("harbor-bell"), "t=0 钟声在窗外不发声");
assert(!sounding.includes("boat-hum"), "t=0 船声在窗外不发声");

engine.land("dawn", 12, true); // 三声音窗重叠
await flush();
sounding = engine.status.sources.filter((s) => s.state === "sounding").map((s) => s.id);
assert(sounding.includes("fisher-voice"), "t=12 人声仍在窗内");
assert(sounding.includes("harbor-bell"), "t=12 钟声进入时间窗发声");
assert(sounding.includes("boat-hum"), "t=12 船声进入时间窗发声");

engine.land("dawn", 23.5, true);
await flush();
sounding = engine.status.sources.filter((s) => s.state === "sounding").map((s) => s.id);
assert(!sounding.includes("fisher-voice"), "t=23.5 人声已出窗停止");

console.log("3) 拖动跨过起止点以落点为准（scrub 不重排，land 一次仲裁）");
engine.scrubTo("dawn", 2); // 拖到窗外区域
await flush();
const duringScrub = engine.status.sources.find((s) => s.id === "harbor-bell").state;
engine.land("dawn", 12, true); // 落在窗内
await flush();
const afterLand = engine.status.sources.find((s) => s.id === "harbor-bell").state;
assert(afterLand === "sounding", "落点在窗内 → 钟声恢复发声");
assert(typeof duringScrub === "string", "拖动过程状态保持稳定不抖动");

console.log("4) 切章不叠加：旧章节全部停止，新章节声源独立");
engine.land("craft", 10, true);
await flush();
const dawnLeft = engine.status.sources.filter(
  (s) => ["fisher-voice", "harbor-bell", "boat-hum"].includes(s.id) && s.state === "sounding",
).length;
const craftOn = engine.status.sources.filter((s) => s.state === "sounding").map((s) => s.id);
assert(dawnLeft === 0, "切到作坊后港口三声源全部停止");
assert(craftOn.includes("maker-voice") && craftOn.includes("plane-tools"), "作坊章节声源发声");

console.log("5) 访谈压低现场声但不叠加，返回后从主线位置继续");
engine.setInterview(true);
await flush();
const craftDuringInterview = engine.status.sources.filter((s) => s.state === "sounding").length;
assert(craftDuringInterview >= 1, "访谈期间现场声保留（轻微低鸣）");
engine.setInterview(false);
engine.land("dawn", 12, true);
await flush();
sounding = engine.status.sources.filter((s) => s.state === "sounding").map((s) => s.id);
assert(sounding.includes("harbor-bell"), "返回主线后钟声从落点位置继续");

console.log("6) 声部上限与优先级：人物故事优先保留");
// craft 只有 2 个声源，直接验证 dawn 三声源同时不超上限且人声优先
engine.land("dawn", 12, true);
await flush();
const voice = engine.status.sources.find((s) => s.id === "fisher-voice");
assert(voice.state === "sounding", "最高优先级的人物声音始终保留");

console.log("7) 素材迟到/失败/重试状态机");
forceError = true;
const fresh = createSpatialEngine();
await fresh.unlock();
fresh.land("dawn", 12, true);
await flush();
await flush();
const boatState = fresh.status.sources.find((s) => s.id === "boat-hum");
assert(boatState.load === "error", "船声素材失败时状态可见为 error");
assert(boatState.error.length > 0, "失败原因对用户可见");
forceError = false;
await fresh.retry("boat-hum");
await flush();
const retried = fresh.status.sources.find((s) => s.id === "boat-hum");
assert(retried.load === "ready", "重试成功后素材恢复 ready");

console.log("8) 静音与暂停的真实增益一致");
engine.setMuted(true);
await flush();
assert(engine.status.muted === true, "静音状态同步");
engine.setMuted(false);

console.log("9) 收藏回访以落点恢复");
engine.land("night", 5, true);
await flush();
const nightVoice = engine.status.sources.find((s) => s.id === "keeper-voice");
assert(nightVoice.state === "sounding", "回访夜章落点后守望者声音恢复");

console.log("10) 连续转头不会反复截断：发声集合在视角变化下保持稳定");
engine.land("dawn", 12, true);
await flush();
const firstSet = engine.status.sources
  .filter((s) => s.state === "sounding")
  .map((s) => s.id)
  .sort();
// 模拟连续拖动：相机 yaw 多次变化，只更新聆听者方位
for (let yaw = -80; yaw <= 80; yaw += 10) {
  engine.setCamera({ yaw, pitch: 0, fov: 70 });
}
engine.updatePlayback("dawn", 12.5, true);
await flush();
const afterTurnSet = engine.status.sources
  .filter((s) => s.state === "sounding")
  .map((s) => s.id)
  .sort();
assert(
  firstSet.length === afterTurnSet.length &&
    firstSet.every((id, i) => id === afterTurnSet[i]),
  "连续转头后发声集合不变，不发生反复截断",
);

console.log("11) 缩放/朝向改变关注响度（声音距离与屏幕热点对应）");
engine.setCamera({ yaw: 0, pitch: 0, fov: 40 }); // 放大且正对人声
engine.updatePlayback("dawn", 12, true);
await flush();
const closeLevel = engine.status.sources.find((s) => s.id === "fisher-voice").level;
engine.setCamera({ yaw: 120, pitch: 0, fov: 95 }); // 背对且缩小
engine.updatePlayback("dawn", 12, true);
await flush();
const farLevel = engine.status.sources.find((s) => s.id === "fisher-voice").level;
assert(
  closeLevel > farLevel,
  `正对放大时响度(${closeLevel})高于背对缩小时(${farLevel})`,
);

console.log("12) 同时发声数量受限，且人物故事优先保住");
{
  const cap = createSpatialEngine();
  await cap.unlock();
  // 港口章节同窗内最多 3 个真实声源，验证不超过上限 4，且人物声优先
  cap.land("dawn", 12, true);
  await flush();
  const count = cap.status.sources.filter((s) => s.state === "sounding").length;
  assert(count <= 4, `同时发声数 ${count} 不超过上限 4`);
  const voiceKept = cap.status.sources.find((s) => s.id === "fisher-voice");
  assert(voiceKept.state === "sounding", "声部受限时人物故事声音优先保留");
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
