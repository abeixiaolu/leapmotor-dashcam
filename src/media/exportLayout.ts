import { directions, type Direction } from "../library";
import { quadrants } from "../mosaicMath";

export type ExportLayout = "focus" | "grid";

/** Fixed landscape export canvas: primary + three previews, or a 2×2 grid. */
export function exportFilter(layout: ExportLayout, primary: Direction): string {
  const crops = directions.map((direction) => {
    const [x, y] = quadrants[direction];
    const large = layout === "focus" && direction === primary;
    const width = layout === "grid" ? 480 : large ? 720 : 240;
    const height = layout === "grid" ? 384 : large ? 576 : 192;
    return `[s${direction}]crop=iw/2:ih/2:iw/2*${x}:ih/2*${y},scale=${width}:${height},setsar=1[${direction}]`;
  });
  const split = `[0:v]split=4${directions.map((d) => `[s${d}]`).join("")}`;
  if (layout === "grid")
    return [
      split,
      ...crops,
      "[front][rear]hstack=inputs=2[top]",
      "[left][right]hstack=inputs=2[bottom]",
      "[top][bottom]vstack=inputs=2[out]",
    ].join(";");
  const previews = directions.filter((d) => d !== primary);
  return [
    split,
    ...crops,
    `${previews.map((d) => `[${d}]`).join("")}vstack=inputs=3[previews]`,
    `[${primary}][previews]hstack=inputs=2[out]`,
  ].join(";");
}
