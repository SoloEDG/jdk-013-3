<script setup lang="ts">
import { computed } from "vue";
import { Volume2, Square, AudioLines } from "lucide-vue-next";
import type { Branch } from "../../interviews/model/branch";
import type { SpatialEngine } from "../model/engine";

const props = defineProps<{
  engine: SpatialEngine;
  branch: Branch;
}>();

const speech = computed(() => props.engine.getSpeech());
const speaking = computed(
  () => speech.value?.state.mode && speech.value.state.mode !== "stopped",
);

function playCurrent() {
  const person = props.branch.person.value;
  if (!person || !speech.value) return;
  void speech.value.speak(
    person.paragraphs[props.branch.paragraph.value]!,
    props.branch.paragraph.value,
  );
}
function stop() {
  speech.value?.stop();
}
</script>

<template>
  <div v-if="branch.person.value && speech" class="speech-bar">
    <button
      v-if="!speaking"
      class="speech-play"
      @click="playCurrent"
    >
      <Volume2 :size="15" /> 朗读这一段（人物讲话清晰播放）
    </button>
    <div v-else class="speech-on">
      <AudioLines :size="15" class="spin-slow" />
      <span>
        正在讲话 ·
        {{ speech.state.mode === "tts" ? "语音合成" : "现场人声（备用）" }}
      </span>
      <button aria-label="停止讲话" @click="stop"><Square :size="13" /></button>
    </div>
    <p v-if="speech.state.error" class="speech-error">{{ speech.state.error }}</p>
    <p class="speech-hint">访谈期间现场声已压低，返回主线后从当前位置继续</p>
  </div>
</template>
