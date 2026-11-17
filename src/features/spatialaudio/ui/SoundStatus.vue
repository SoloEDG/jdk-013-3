<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Volume2,
  VolumeX,
  Loader2,
  HeadphoneOff,
  AlertTriangle,
  Lock,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  AudioLines,
} from "lucide-vue-next";
import type { SpatialEngine, SourceStatus } from "../model/engine";

const props = defineProps<{ engine: SpatialEngine }>();
const open = ref(false);

const phase = computed(() => props.engine.status.phase);
const anyLoading = computed(() =>
  props.engine.status.sources.some((s) => s.load === "loading"),
);
const anyError = computed(() =>
  props.engine.status.sources.some((s) => s.load === "error"),
);
const soundingCount = computed(
  () => props.engine.status.sources.filter((s) => s.state === "sounding").length,
);
const chapterSources = computed(() =>
  props.engine.status.sources.filter((s) => s.state !== "off"),
);

const phaseMeta = computed(() => {
  switch (phase.value) {
    case "locked":
      return { icon: Lock, text: "点击开启声音", tone: "locked" };
    case "suspended":
      return { icon: VolumeX, text: "声音已暂停，点击恢复", tone: "warn" };
    case "no-output":
      return { icon: HeadphoneOff, text: "未检测到音频输出", tone: "warn" };
    case "unsupported":
      return { icon: AlertTriangle, text: "浏览器不支持空间音频", tone: "error" };
    default:
      return {
        icon: props.engine.status.muted ? VolumeX : Volume2,
        text: props.engine.status.muted
          ? "已静音"
          : `现场声 · ${soundingCount.value} 处`,
        tone: "ok",
      };
  }
});

function kindText(s: SourceStatus) {
  return {
    bell: "钟声",
    boat: "船声",
    voice: "人声",
    tool: "劳作声",
    wind: "风声",
  }[s.kind];
}
function stateText(s: SourceStatus) {
  switch (s.state) {
    case "sounding":
      return "发声中";
    case "loading":
      return "素材到达中";
    case "muted-slot":
      return "等待声部";
    case "out-of-window":
      return "时间窗外";
    default:
      return "未激活";
  }
}
</script>

<template>
  <div class="sound-status" :class="phaseMeta.tone">
    <button class="sound-chip" @click="engine.unlock()">
      <component :is="phaseMeta.icon" :size="14" />
      <span>{{ phaseMeta.text }}</span>
      <Loader2 v-if="anyLoading" :size="13" class="spin" />
      <i v-if="soundingCount && phase === 'ready' && !engine.status.muted" class="live-dot" />
    </button>
    <button
      v-if="engine.isUnlocked()"
      class="sound-mute"
      :aria-label="engine.status.muted ? '取消静音' : '静音'"
      @click="engine.setMuted(!engine.status.muted)"
    >
      <VolumeX v-if="engine.status.muted" :size="14" />
      <Volume2 v-else :size="14" />
    </button>
    <button
      v-if="engine.isUnlocked()"
      class="sound-expand"
      :aria-expanded="open"
      aria-label="声音现场详情"
      @click="open = !open"
    >
      <ChevronUp v-if="open" :size="14" />
      <ChevronDown v-else :size="14" />
    </button>

    <div v-if="open" class="sound-panel" role="status">
      <p v-if="engine.status.deviceNote" class="device-note">
        <HeadphoneOff :size="13" /> {{ engine.status.deviceNote }}
      </p>
      <ul>
        <li v-for="s in chapterSources" :key="s.id" :class="s.state">
          <span class="s-kind"><AudioLines :size="12" />{{ kindText(s) }}</span>
          <span class="s-label">{{ s.label }}</span>
          <span class="s-state">
            <Loader2 v-if="s.state === 'loading'" :size="12" class="spin" />
            <AlertTriangle v-else-if="s.load === 'error'" :size="12" />
            {{ s.error || stateText(s) }}
          </span>
          <i v-if="s.state === 'sounding'" class="level-bar">
            <b :style="{ width: Math.round(s.level * 100) + '%' }" />
          </i>
          <button
            v-if="s.load === 'error'"
            class="s-retry"
            @click="engine.retry(s.id)"
          >
            <RefreshCw :size="11" /> 重试
          </button>
        </li>
      </ul>
      <p v-if="anyError" class="panel-hint">个别素材迟到不影响其他现场声</p>
    </div>
  </div>
</template>
