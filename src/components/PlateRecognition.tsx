import { useEffect, useState } from "react";
import { RiCarLine, RiRefreshLine, RiStopCircleLine, RiPlayLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Drawer, DrawerHeader, DrawerFooter } from "@/components/base/drawer/drawer";
import { Spinner } from "@/components/base/spinner/spinner";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { clock, labels } from "@/library";
import type { Direction } from "@/library";
import { usePlateScan } from "@/plates/usePlateScan";
import { plateSampleInterval } from "@/plates/scan";
import { MAX_PLATE_CANDIDATES, plateText } from "@/plates/observations";
import type { PlateCandidate, PlateScan } from "@/plates/types";
import { cx } from "@/utils/cx";

function scanLabel(scan: PlateScan) {
  switch (scan.kind) {
    case "checking-cache":
      return "正在读取暂存结果";
    case "cached":
      return scan.candidates.length
        ? `已读取暂存结果 · ${scan.candidates.length} 条候选`
        : "已读取暂存结果 · 暂未识别到车牌";
    case "idle":
    case "loading":
      return "车牌识别中 · 正在准备";
    case "scanning":
      return `车牌识别中 · ${Math.floor((scan.completed / scan.total) * 100)}%`;
    case "complete":
      return scan.candidates.length
        ? `识别完成 · ${scan.candidates.length} 条候选`
        : "识别完成 · 暂未识别到车牌";
    case "stopped":
      return "车牌识别已停止";
    case "error":
      return "车牌识别未完成";
    default: {
      const exhaustive: never = scan;
      return exhaustive;
    }
  }
}

function PlatePreview({
  candidate,
  onSelect,
}: {
  candidate: PlateCandidate;
  onSelect: () => void;
}) {
  const [imageURL, setImageURL] = useState("");
  const text = plateText(candidate);
  useEffect(() => {
    const url = URL.createObjectURL(candidate.thumbnail);
    setImageURL(url);
    return () => URL.revokeObjectURL(url);
  }, [candidate.thumbnail]);
  return (
    <li className="flex flex-col gap-3 rounded-3xl border border-border-button-default bg-background-primary-default p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-secondary-default">
          {imageURL && (
            <img
              src={imageURL}
              alt={`${text} 候选车牌的原始画面`}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <bdi className="text-headline-medium text-text-primary" dir="ltr">
            {text}
          </bdi>
          <p className="text-caption-1-regular text-text-secondary">
            {labels[candidate.direction]} · {clock(candidate.time)}
          </p>
          <p className="text-caption-1-regular text-text-tertiary">
            {candidate.observations > 1
              ? `合并 ${candidate.observations} 次采样，需核对`
              : "单次识别，需核对"}
          </p>
          {candidate.province.kind !== "read" && (
            <p className="text-caption-1-regular text-text-secondary">
              {candidate.province.kind === "conflict"
                ? "省份简称识别有分歧，首字待确认"
                : "省份简称未识别清楚，首字待确认"}
            </p>
          )}
        </div>
      </div>
      <Button variant="secondary" size="small" leadingIcon={RiPlayLine} onClick={onSelect}>
        跳到录像核对
      </Button>
    </li>
  );
}

export function PlateRecognition({
  src,
  recordingId,
  duration,
  portalContainer,
  onSelect,
}: {
  src: string;
  recordingId: string;
  duration: number;
  portalContainer?: HTMLElement;
  onSelect: (time: number, direction: Direction) => void;
}) {
  const { scan, stop, retry } = usePlateScan({ src, recordingId });
  const [open, setOpen] = useState(false);
  const fade = useScrollFade();
  const busy =
    scan.kind === "checking-cache" || scan.kind === "loading" || scan.kind === "scanning";
  const candidates = "candidates" in scan ? scan.candidates : [];
  const label = scanLabel(scan);
  const interval = plateSampleInterval(duration);
  const setPanelOpen = (next: boolean) => {
    fade.reset();
    setOpen(next);
  };
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-separator-border pt-3">
      <div className="flex min-w-0 items-center gap-2" role="status">
        {busy && <Spinner size="xs" aria-label={label} />}
        <span className="text-caption-1-regular text-text-secondary">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {busy && (
          <Button variant="ghost" size="xs" onClick={stop}>
            停止识别
          </Button>
        )}
        <Button
          variant="secondary"
          size="xs"
          leadingIcon={RiCarLine}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setPanelOpen(true)}
        >
          查看车牌{candidates.length ? ` · ${candidates.length}` : ""}
        </Button>
      </div>
      <Drawer
        placement="end"
        size="md"
        isOpen={open}
        onOpenChange={setPanelOpen}
        UNSTABLE_portalContainer={portalContainer}
      >
        <DrawerHeader
          title="车牌识别"
          description="候选号码请结合原始录像核对。"
          closeLabel="关闭车牌识别"
        />
        <div className="flex flex-col gap-2 px-6">
          <p
            role="status"
            className={cx(
              "text-body-2-medium",
              scan.kind === "error" ? "text-text-error-primary" : "text-text-primary",
            )}
          >
            {label}
          </p>
          <p className="text-caption-1-regular text-text-secondary">
            约每 {interval.toFixed(interval === 1 ? 0 : 1)}{" "}
            秒抽取四个视角，在本机识别。短暂出现或模糊的车牌可能遗漏。
          </p>
          <p className="text-caption-1-regular text-text-tertiary">
            支持普通民用和新能源车牌，暂不支持特殊后缀车牌。
          </p>
          {scan.kind === "cached" && (
            <p className="text-caption-1-regular text-text-secondary">
              暂存结果有效至 {new Date(scan.expiresAt).toLocaleString("zh-CN", { hour12: false })}。
              点击「重新识别」可更新结果。
            </p>
          )}
          {scan.kind === "error" && (
            <p role="alert" className="text-caption-1-regular text-text-error-primary">
              {scan.message}
            </p>
          )}
          {candidates.length >= MAX_PLATE_CANDIDATES && (
            <p className="text-caption-1-regular text-text-tertiary">
              最多显示 {MAX_PLATE_CANDIDATES} 条候选记录。
            </p>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            className="h-full overflow-y-auto overscroll-contain px-6 py-4"
            onScroll={fade.onScroll}
          >
            {candidates.length ? (
              <ul className="flex flex-col gap-3">
                {candidates
                  .toSorted((a, b) => a.time - b.time)
                  .map((candidate) => (
                    <PlatePreview
                      key={candidate.id}
                      candidate={candidate}
                      onSelect={() => {
                        onSelect(candidate.time, candidate.direction);
                        setPanelOpen(false);
                      }}
                    />
                  ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-body-2-regular text-text-tertiary">
                {busy
                  ? "正在查找车牌，可以关闭面板继续观看。"
                  : "暂无候选车牌。可在录像中放大画面手动核对。"}
              </p>
            )}
          </div>
          <ScrollFade progress={fade.progress} surfaceClassName="from-background-full" />
        </div>
        <DrawerFooter>
          {busy ? (
            <Button variant="secondary" leadingIcon={RiStopCircleLine} onClick={stop}>
              停止识别
            </Button>
          ) : (
            <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={retry}>
              重新识别
            </Button>
          )}
        </DrawerFooter>
      </Drawer>
    </div>
  );
}
