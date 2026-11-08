export const directions = ["front", "rear", "left", "right"] as const;
export type Direction = (typeof directions)[number];
export const labels: Record<Direction, string> = {
  front: "前方",
  rear: "后方",
  left: "左侧",
  right: "右侧",
};
export const clock = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
