/** Preserve the browser diagnostic to distinguish decoder failures from file reads. */
export function playbackErrorMessage(error: Pick<MediaError, "code" | "message"> | null): string {
  const messages: Record<number, string> = {
    1: "录像载入已中断，请重新打开片段。",
    2: "无法读取播放数据，请重新选择录像后重试。",
    3: "浏览器无法解码这段录像。",
    4: "浏览器不支持这段录像的播放格式。",
  };
  if (!error) return "录像播放失败，请重新打开片段。";
  const summary = messages[error.code] || "录像播放失败。";
  const detail = error.message?.trim().slice(0, 240);
  return `${summary}（错误 ${error.code}${detail ? `：${detail}` : ""}）`;
}
