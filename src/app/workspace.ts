import { ref, watch } from "vue";
import { createCamera } from "../features/panorama";
import { createPlayback } from "../features/chapters";
import { createDiscovery } from "../features/hotspots";
import { createBranch } from "../features/interviews";
import { createJournal } from "../features/journal";
import { createSpatialEngine, type SpatialEngine } from "../features/spatialaudio";
import type { Command, Position } from "../shared/types";

export function createWorkspace() {
  const camera = createCamera(),
    playback = createPlayback(),
    discovery = createDiscovery(() => playback.state),
    branch = createBranch(),
    journal = createJournal(),
    audio: SpatialEngine = createSpatialEngine(),
    tab = ref("story");

  // 视角变化实时同步到空间音频聆听者（转头/缩放改变方位与距离感）
  watch(
    () => ({ ...camera.camera }),
    (value) => audio.setCamera(value),
    { deep: true },
  );
  // 播放状态（暂停/继续）与章节时间推进同步到音频仲裁。
  // 章节切换与跳转落点由 dispatch 显式处理，幂等仲裁重复执行无副作用。
  watch(
    () => [
      playback.state.chapterId,
      playback.state.time,
      playback.state.playing,
    ],
    ([chapterId, time, playing]) =>
      audio.updatePlayback(chapterId as string, time as number, playing as boolean),
  );
  watch(
    () => playback.state.muted,
    (muted) => audio.setMuted(muted),
  );

  const position = (): Position => ({
    chapterId: playback.state.chapterId,
    time: playback.state.time,
    camera: { ...camera.camera },
    playing: playback.state.playing,
  });

  function enterPerson(id: string) {
    branch.enter(id, position());
    playback.state.playing = false;
    discovery.close();
    // 进入访谈：保留轻微现场声，讲话走独立总线，不叠加第二份现场声
    audio.setInterview(true);
  }

  function dispatch(command: Command) {
    switch (command.type) {
      case "chapter":
        if (branch.personId.value) return;
        playback.select(command.id);
        camera.reset();
        discovery.close();
        audio.land(command.id, 0, false);
        break;
      case "seek":
        // 点击进度条的跳转：以落点为准恢复声音
        playback.seek(command.time);
        audio.land(
          playback.state.chapterId,
          playback.state.time,
          playback.state.playing,
        );
        break;
      case "hotspot":
        discovery.select(command.id);
        break;
      case "return": {
        const saved = branch.leave();
        audio.setInterview(false);
        if (saved) {
          playback.select(saved.chapterId);
          playback.seek(saved.time);
          camera.restore(saved.camera);
          playback.state.playing = saved.playing;
          // 回到主线：现场声从保存的主线位置继续，不重新叠加
          audio.land(saved.chapterId, saved.time, saved.playing);
        }
        break;
      }
      case "revisit":
        branch.leave();
        audio.setInterview(false);
        playback.select(command.entry.chapterId);
        playback.seek(command.entry.time);
        camera.restore(command.entry.camera);
        discovery.select(command.entry.hotspotId);
        tab.value = "story";
        // 收藏回访同样以落点为准恢复
        audio.land(
          command.entry.chapterId,
          command.entry.time,
          playback.state.playing,
        );
        break;
    }
  }

  function save() {
    const h = discovery.detail.value;
    if (h) journal.save(h, position());
  }

  return {
    camera,
    playback,
    discovery,
    branch,
    journal,
    audio,
    tab,
    position,
    enterPerson,
    dispatch,
    save,
  };
}
