import { MotionText } from "@/components/Motion";
import { useState } from "react";
import Calendar from "@carbon/icons-react/es/Calendar.js";
import Help from "@carbon/icons-react/es/Help.js";
import Usb from "@carbon/icons-react/es/Usb.js";
import Video from "@carbon/icons-react/es/Video.js";
import ChevronRight from "@carbon/icons-react/es/ChevronRight.js";
import FolderOpen from "@carbon/icons-react/es/FolderOpen.js";
import { Button } from "@/components/base/buttons/button";
import { Spinner } from "@/components/base/spinner/spinner";
import { Modal, ModalBody, ModalHeader, ModalTrigger } from "@/components/base/modal/modal";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { RecordingCalendar } from "@/RecordingCalendar";
import type { Drive, Recording } from "@/App";
import { cx } from "@/utils/cx";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";

type Props = {
  drives: Drive[];
  drive: Drive | undefined;
  records: Recording[];
  shown: Recording[];
  kind: "drive" | "sentinel";
  setKind: (kind: "drive" | "sentinel") => void;
  setDriveId: (id: string) => void;
  date: string;
  counts: Map<string, number>;
  scanError: string;
  selectedId?: string;
  /** Hide the brand header (drawer already has a title). */
  hideBrand?: boolean;
  className?: string;
  picking?: boolean;
  pickProgress?: string;
  onDate: (date: string) => void;
  onChoose: (id: string) => void;
  onPickFolder?: () => void;
  fileSelectionLimit?: number;
  /** Multi-select fallback for browsers without directory access. */
  onPickFiles?: () => void;
  onHelp: () => void;
};

export function RecordingList(p: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const fade = useScrollFade();
  const driveCount = p.records.filter((r) => r.kind === "drive").length;
  const sentinelCount = p.records.filter((r) => r.kind === "sentinel").length;

  return (
    <div
      className={cx(
        "recording-list flex h-full min-h-0 flex-col bg-background-primary-default",
        p.className,
      )}
    >
      {!p.hideBrand && (
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-separator-border px-4">
          <div className="flex min-w-0 items-center gap-2 text-body-medium text-text-primary">
            <Video className="size-6 shrink-0" aria-hidden />
            <span className="truncate">零跑记录仪</span>
          </div>
          <Button
            variant="ghost"
            size="small"
            leadingIcon={Help}
            className="text-text-secondary"
            onClick={p.onHelp}
          >
            指南
          </Button>
        </header>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          onScroll={fade.onScroll}
          tabIndex={0}
          aria-label="录像资料库内容"
          className="h-full min-h-0 overflow-y-auto overscroll-contain pb-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
        >
          <div className="flex flex-col gap-4 px-4 pt-5 pb-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h1 className="text-caption-1-semibold text-text-secondary">录像资料库</h1>
                {p.drive && (
                  <p className="shrink-0 text-caption-1-regular text-text-tertiary">
                    {p.records.length} 段录像
                  </p>
                )}
              </div>
              {p.picking && (
                <div
                  className="flex items-start gap-3 rounded-xl border border-border-button-default bg-background-secondary-default p-3"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <Spinner size="sm" aria-hidden className="mt-1" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-body-2-medium text-text-primary">录像加载中…</p>
                    <p className="text-caption-1-regular text-text-secondary">
                      {p.pickProgress || "正在等待所选文件，准备完成后会自动更新列表。"}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Usb className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-primary">
                  {p.drive?.name || "未选择录像"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.onPickFolder && (
                  <Button
                    size="small"
                    variant="secondary"
                    leadingIcon={FolderOpen}
                    className="flex-1 shadow-none"
                    onClick={p.onPickFolder}
                  >
                    {p.picking ? "取消等待" : "选择 U 盘/文件夹"}
                  </Button>
                )}
                {p.onPickFiles && (
                  <Button
                    size="small"
                    variant="secondary"
                    leadingIcon={FolderOpen}
                    className="w-full shadow-none"
                    onClick={p.onPickFiles}
                  >
                    {p.picking ? "取消等待" : p.fileSelectionLimit ? "添加录像" : "多选录像文件"}
                  </Button>
                )}
              </div>
              {p.fileSelectionLimit && (
                <p className="text-caption-1-regular text-text-secondary">
                  移动端每次选择一段 .h264 录像，添加到现有列表；重复选择不会重复添加。
                </p>
              )}
              {p.scanError && (
                <p
                  key={p.scanError}
                  className="motion-enter text-caption-1-regular text-text-error-primary"
                  role="status"
                >
                  {p.scanError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-separator-border pt-4">
              {p.drives.length > 1 && (
                <Select
                  aria-label="选择U盘"
                  selectedKey={p.drive?.id}
                  onSelectionChange={(key) => key != null && p.setDriveId(String(key))}
                  size="sm"
                  className="w-full"
                  triggerClassName="shadow-none"
                  renderValue={() => p.drive?.name}
                >
                  {p.drives.map((d) => (
                    <SelectItem key={d.id} id={d.id} textValue={d.name}>
                      {d.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
              <SegmentedControl
                selectedKeys={new Set([p.kind])}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (next === "drive" || next === "sentinel") p.setKind(next);
                }}
                className="w-full"
                aria-label="录像分类"
              >
                <SegmentedControlItem id="drive" className="flex-1 gap-2">
                  行车
                  <span className="text-caption-1-regular text-text-tertiary tabular-nums">
                    <MotionText>{driveCount}</MotionText>
                  </span>
                </SegmentedControlItem>
                <SegmentedControlItem id="sentinel" className="flex-1 gap-2">
                  哨兵
                  <span className="text-caption-1-regular text-text-tertiary tabular-nums">
                    <MotionText>{sentinelCount}</MotionText>
                  </span>
                </SegmentedControlItem>
              </SegmentedControl>
              <ModalTrigger isOpen={calendarOpen} onOpenChange={setCalendarOpen}>
                <Button
                  variant="secondary"
                  size="small"
                  leadingIcon={Calendar}
                  trailingIcon={ChevronRight}
                  className="w-full justify-between shadow-none [&>span]:flex-1 [&>span]:justify-start"
                  aria-label={p.date ? `选择录像日期，当前 ${p.date}` : "选择录像日期"}
                >
                  {p.date || "选择日期"}
                </Button>
                <Modal size="sm">
                  {({ close }) => (
                    <>
                      <ModalHeader title="选择录像日期" />
                      <ModalBody>
                        <RecordingCalendar
                          date={p.date}
                          counts={p.counts}
                          onSelect={(date) => {
                            p.onDate(date);
                            close();
                            setCalendarOpen(false);
                          }}
                        />
                      </ModalBody>
                    </>
                  )}
                </Modal>
              </ModalTrigger>
            </div>
            <div className="flex items-center justify-between text-caption-1-regular text-text-tertiary">
              <span>录像</span>
              <span className="tabular-nums">
                <MotionText>{`${p.shown.length} 段`}</MotionText>
              </span>
            </div>
          </div>

          <div key={`${p.drive?.id}-${p.kind}-${p.date}`} className="motion-enter px-2">
            {p.shown.length ? (
              <div className="flex flex-col gap-1">
                {p.shown.map((r) => {
                  const active = p.selectedId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => p.onChoose(r.id)}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "recording-row group flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                        active
                          ? "border-border-button-default bg-background-secondary-default"
                          : "border-transparent hover:bg-background-secondary-default",
                      )}
                    >
                      <Video
                        className={cx(
                          "size-4 shrink-0",
                          active ? "text-foreground-icon-primary" : "text-foreground-icon-tertiary",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-2-medium text-text-primary tabular-nums">
                          {r.stamp.split(" ")[1] || r.stamp}
                        </span>
                        <span className="block text-caption-1-regular text-text-tertiary">
                          {r.stamp.split(" ")[0]} · 四路全景
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-foreground-icon-tertiary rtl:rotate-180"
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            ) : !p.picking ? (
              <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                <Usb className="size-7 text-foreground-icon-tertiary" aria-hidden />
                <p className="text-body-2-medium text-text-secondary">
                  {p.drive ? "这一天没有录像" : "选择录像，开始回看"}
                </p>
                <p className="max-w-xs text-caption-1-regular text-text-tertiary">
                  {p.drive
                    ? "试试其他日期或录像分类。"
                    : p.fileSelectionLimit
                      ? `在「浏览」中进入 U 盘的录像目录，选择 ${p.fileSelectionLimit} 个 .h264 文件后点「打开」。`
                      : p.onPickFiles
                        ? "在「浏览」中进入 U 盘或录像文件夹，点右上角「打开」，即可自动整理其中的录像。"
                        : "选择 U 盘或本机录像文件夹，文件不会上传。"}
                </p>
                {!p.drive && !p.picking && (
                  <>
                    {p.onPickFolder && (
                      <Button
                        variant="secondary"
                        size="small"
                        leadingIcon={FolderOpen}
                        className="shadow-none"
                        onClick={p.onPickFolder}
                      >
                        选择 U 盘/文件夹
                      </Button>
                    )}
                    {p.onPickFiles && !p.picking && (
                      <Button
                        variant="secondary"
                        size="small"
                        leadingIcon={FolderOpen}
                        className="shadow-none"
                        onClick={p.onPickFiles}
                      >
                        {p.fileSelectionLimit ? "添加录像" : "多选录像文件"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <ScrollFade progress={fade.progress} surfaceClassName="from-background-primary-default" />
      </div>
    </div>
  );
}
