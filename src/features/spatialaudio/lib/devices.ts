export interface DeviceState {
  /** 当前是否仍有可用音频输出设备 */
  hasOutput: boolean;
  /** 最近一次变化是否为拔出 */
  disconnected: boolean;
}

/**
 * 监听耳机/扬声器拔出与重新接入。
 * enumerateDevices 在未授予权限时可能只看到空 label，这里以 device 数量变化为准。
 */
export function watchOutputDevices(
  onChange: (state: DeviceState) => void,
): () => void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return () => {};
  }
  const countOutputs = () =>
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => devices.filter((d) => d.kind === "audiooutput").length)
      .catch(() => 1);

  let previous = 1;
  countOutputs().then((n) => {
    previous = Math.max(1, n);
  });

  const handler = async () => {
    const count = Math.max(0, await countOutputs());
    if (count < previous) {
      onChange({ hasOutput: count > 0, disconnected: true });
    } else if (count > previous) {
      onChange({ hasOutput: true, disconnected: false });
    }
    previous = Math.max(previous, count);
  };
  navigator.mediaDevices.addEventListener("devicechange", handler);
  return () =>
    navigator.mediaDevices.removeEventListener("devicechange", handler);
}
