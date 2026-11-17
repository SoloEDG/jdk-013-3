import type { Camera, SoundSourceConfig } from "../../../shared/types";
import { wrap } from "../../../shared/format";

/**
 * 全景球坐标（yaw/pitch，单位度）→ 以聆听者为原点的三维方位。
 * 与全景渲染器 camera.lookAt 使用同一套约定，保证声音与画面同方向。
 */
export function sourceVector(source: SoundSourceConfig): [number, number, number] {
  const phi = (Math.PI / 180) * (90 - source.pitch);
  const theta = (Math.PI / 180) * source.yaw;
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ];
}

/** 聆听者朝向（相机正前方）与正上方向量。 */
export function listenerOrientation(camera: Camera): {
  forward: [number, number, number];
  up: [number, number, number];
} {
  const phi = (Math.PI / 180) * (90 - camera.pitch);
  const theta = (Math.PI / 180) * camera.yaw;
  return {
    forward: [
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ],
    up: [0, 1, 0],
  };
}

/** 声源相对当前朝向的偏航夹角（度，-180~180）与俯仰夹角（度）。 */
export function angularDelta(
  source: SoundSourceConfig,
  camera: Camera,
): { yaw: number; pitch: number } {
  return {
    yaw: wrap(source.yaw - camera.yaw),
    pitch: source.pitch - camera.pitch,
  };
}

/**
 * 关注系数：声源越靠近屏幕中心、缩放越大，声音越突出。
 * 与热点投影使用同样的正切几何，保证"屏幕热点 ↔ 声音距离"对应。
 */
export function attentionFactor(
  source: SoundSourceConfig,
  camera: Camera,
): number {
  const delta = angularDelta(source, camera);
  const yawRad = (delta.yaw * Math.PI) / 180;
  const pitchRad = (delta.pitch * Math.PI) / 180;
  const screenDist = Math.sqrt(
    Math.tan(yawRad) ** 2 + Math.tan(pitchRad) ** 2,
  );
  // fov 35°~95° 映射到 0~1 的缩放加成（放大时近场更突出）
  const zoomBoost = (95 - camera.fov) / (95 - 35);
  const centered = Math.max(0, 1 - screenDist / 2.2);
  return 0.72 + 0.28 * centered + 0.18 * zoomBoost;
}

/** 时间窗判定（与热点可见性一致：左闭右开）。 */
export function inWindow(source: SoundSourceConfig, time: number): boolean {
  return time >= source.start && time < source.end;
}
