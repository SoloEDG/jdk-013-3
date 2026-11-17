export interface Camera {
  yaw: number;
  pitch: number;
  fov: number;
}
export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  duration: number;
  panorama: string;
  video: string;
  location: string;
  description: string;
}
export type SoundKind = "bell" | "boat" | "voice" | "tool" | "wind";
export interface SoundSourceConfig {
  id: string;
  chapterId: string;
  /** 关联的屏幕热点，保证声音方位与热点位置一致 */
  hotspotId: string;
  label: string;
  kind: SoundKind;
  start: number;
  end: number;
  yaw: number;
  pitch: number;
  /** 声音优先级：当前关注的人物故事最高 */
  priority: number;
  /** 真实素材走网络解码；其余在解锁后程序化合成 */
  src?: string;
  /** 循环素材的节拍周期（秒），钟声按此周期敲响 */
  period?: number;
}
export interface Hotspot {
  id: string;
  chapterId: string;
  title: string;
  kind: "person" | "archive" | "sound";
  start: number;
  end: number;
  yaw: number;
  pitch: number;
  summary: string;
  personId?: string;
}
export interface Person {
  id: string;
  name: string;
  role: string;
  quote: string;
  paragraphs: string[];
}
export interface Position {
  chapterId: string;
  time: number;
  camera: Camera;
  playing: boolean;
}
export interface Entry {
  id: string;
  hotspotId: string;
  chapterId: string;
  time: number;
  camera: Camera;
  title: string;
  note: string;
  createdAt: number;
}
export type Command =
  | { type: "chapter"; id: string }
  | { type: "seek"; time: number }
  | { type: "hotspot"; id: string }
  | { type: "return" }
  | { type: "revisit"; entry: Entry };
