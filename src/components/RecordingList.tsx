import { useState } from "react";
import {
  RiCalendarLine,
  RiHardDrive2Line,
  RiQuestionLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiUsbLine,
  RiVideoLine,
  RiArrowRightSLine,
  RiFolderOpenLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badge";
import { Modal, ModalBody, ModalHeader, ModalTrigger } from "@/components/base/modal/modal";
import { SearchField } from "@/components/base/search-field/search-field";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { RecordingCalendar } from "../RecordingCalendar";
import type { Drive, Recording } from "../App";
import { cx } from "@/utils/cx";

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
  query: string;
  setQuery: (query: string) => void;
  scanning: boolean;
  scanError: string;
  selectedId?: string;
  /** Hide the brand header (drawer already has a title). */
  hideBrand?: boolean;
  className?: string;
  picking?: boolean;
  pickProgress?: string;
  sourceMode?: "auto" | "local";
  onDate: (date: string) => void;
  onChoose: (id: string) => void;
  onScan: () => void;
  onPickFolder: () => void;
  /** iOS fallback: multi-select .h264 without webkitdirectory */
  onPickFiles?: () => void;
  onHelp: () => void;
};

export function RecordingList(p: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const driveCount = p.records.filter((r) => r.kind === "drive").length;
  const sentinelCount = p.records.filter((r) => r.kind === "sentinel").length;

  return (
    <div
      className={cx("recording-list flex h-full min-h-0 flex-col bg-background-full", p.className)}
    >
      {!p.hideBrand && (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-separator-border bg-background-primary-default/90 px-4 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2.5 text-title-3-semibold text-accent-700">
            <span className="grid size-9 place-items-center rounded-2lg bg-accent-100 text-accent-700">
              <RiVideoLine className="size-5" aria-hidden />
            </span>
            <span className="truncate">零跑记录仪</span>
          </div>
          <Button variant="ghost" size="small" leadingIcon={RiQuestionLine} onClick={p.onHelp}>
            指南
          </Button>
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-title-3-semibold text-text-primary">录像资料库</h1>
            <p className="mt-1 text-caption-1-regular text-text-secondary">
              {p.drive
                ? `${p.drive.name} · ${p.records.length} 段${p.sourceMode === "local" ? " · 本机选择" : ""}`
                : "等待插入 U 盘，或从「文件」选择文件夹"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiFolderOpenLine}
              disabled={p.scanning && !p.picking}
              onClick={p.onPickFolder}
            >
              {p.picking ? "取消选择" : "选择文件夹"}
            </Button>
            {p.onPickFiles ? (
              <Button
                size="small"
                variant="secondary"
                leadingIcon={RiFolderOpenLine}
                disabled={p.scanning && !p.picking}
                onClick={p.onPickFiles}
              >
                {p.picking ? "取消选择" : "多选录像文件"}
              </Button>
            ) : null}
            <Button
              size="small"
              leadingIcon={RiRefreshLine}
              disabled={p.scanning || p.picking}
              onClick={p.onScan}
              className={cx(p.scanning && "scanning-btn")}
            >
              {p.scanning ? "扫描中" : p.sourceMode === "local" ? "自动扫描" : "扫描"}
            </Button>
          </div>
        </div>

        <section className="flex items-start gap-3 rounded-2xl border border-separator-border bg-background-secondary-default p-3 shadow-card">
          <span className="grid size-10 shrink-0 place-items-center rounded-2lg border border-separator-border bg-background-primary-default text-accent-600">
            <RiUsbLine className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-2-medium text-text-primary">
              {p.drive ? p.drive.name : "未检测到 U 盘"}
            </p>
            <p className="mt-0.5 text-caption-1-regular text-text-secondary">
              {p.drive
                ? p.sourceMode === "local"
                  ? "来自「文件」授权的文件夹（只读）"
                  : "插入后自动只读扫描"
                : "电脑插入可自动识别；iPhone 请点「选择文件夹」"}
            </p>
            {(p.picking || p.pickProgress) && (
              <p className="mt-1 text-caption-1-medium text-accent-700" role="status">
                {p.pickProgress ||
                  (p.picking
                    ? "已打开系统选择器：在「文件」中选整个盘或 driverecord 后返回；也可点「取消选择」。"
                    : "处理中…")}
              </p>
            )}
          </div>
          <div className="hidden items-center gap-1 text-caption-1-medium text-accent-700 xl:flex">
            <RiShieldCheckLine className="size-3.5" aria-hidden />
            只读
          </div>
        </section>

        {p.scanError && (
          <div
            className="rounded-2lg border border-status-yellow-background bg-status-yellow-background px-3 py-2.5 text-body-2-regular text-status-yellow-text"
            role="status"
          >
            {p.scanError}
          </div>
        )}

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-separator-border bg-background-primary-default p-3 shadow-card sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-body-medium text-text-primary">所有录像</h2>
              <p className="text-caption-1-regular text-text-secondary">{p.shown.length} 段</p>
            </div>
            {p.drives.length > 1 && (
              <Select
                aria-label="选择U盘"
                selectedKey={p.drive?.id}
                onSelectionChange={(key) => key != null && p.setDriveId(String(key))}
                size="sm"
                className="w-[10.5rem]"
                renderValue={() => (
                  <span className="flex items-center gap-1.5">
                    <RiHardDrive2Line className="size-4 text-text-secondary" aria-hidden />
                    {p.drive?.name}
                  </span>
                )}
              >
                {p.drives.map((d) => (
                  <SelectItem key={d.id} id={d.id} textValue={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </Select>
            )}
          </div>

          <div className="mb-3 flex flex-col gap-2">
            <SegmentedControl
              selectedKeys={new Set([p.kind])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next === "drive" || next === "sentinel") p.setKind(next);
              }}
              className="w-full"
              aria-label="录像分类"
            >
              <SegmentedControlItem id="drive" className="flex-1">
                行车{" "}
                <Badge className="ms-1" color="neutral">
                  {driveCount}
                </Badge>
              </SegmentedControlItem>
              <SegmentedControlItem id="sentinel" className="flex-1">
                哨兵{" "}
                <Badge className="ms-1" color="neutral">
                  {sentinelCount}
                </Badge>
              </SegmentedControlItem>
            </SegmentedControl>

            <div className="flex flex-wrap items-center gap-2">
              <ModalTrigger isOpen={calendarOpen} onOpenChange={setCalendarOpen}>
                <Button
                  variant="secondary"
                  size="small"
                  leadingIcon={RiCalendarLine}
                  trailingIcon={RiArrowRightSLine}
                >
                  {p.date || "选择日期"}
                </Button>
                <Modal size="sm">
                  {({ close }) => (
                    <>
                      <ModalHeader title="选择录像日期" description="选择有录像的日期进行筛选。" />
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

              <SearchField
                aria-label="搜索录像"
                placeholder="搜索日期、时间"
                value={p.query}
                onChange={p.setQuery}
                shape="rounded"
                size="medium"
                className="min-w-0 flex-1"
                isLoading={p.scanning && !p.shown.length}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {p.shown.length ? (
              p.shown.map((r) => {
                const active = p.selectedId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => p.onChoose(r.id)}
                    aria-current={active ? "true" : undefined}
                    className={cx(
                      "group flex min-h-12 items-center gap-3 rounded-2lg border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                      active
                        ? "border-accent-300 bg-accent-50 text-accent-900"
                        : "border-separator-border bg-background-primary-default hover:bg-background-primary-hover",
                    )}
                  >
                    <span
                      className={cx(
                        "grid size-9 place-items-center rounded-lg",
                        active
                          ? "bg-accent-100 text-accent-700"
                          : "bg-background-secondary-default text-accent-700",
                      )}
                    >
                      <RiVideoLine className="size-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-2-medium text-text-primary">
                        {r.stamp.split(" ")[1] || r.stamp}
                      </span>
                      <span className="mt-0.5 block text-caption-1-regular text-text-secondary">
                        {r.stamp.split(" ")[0]} · 四路全景
                      </span>
                    </span>
                    <RiArrowRightSLine
                      className={cx(
                        "size-5 transition-transform group-hover:translate-x-0.5",
                        active
                          ? "text-accent-600"
                          : "text-text-tertiary group-hover:text-accent-600",
                      )}
                      aria-hidden
                    />
                  </button>
                );
              })
            ) : (
              <div className="flex flex-col items-center px-3 py-10 text-center">
                <span className="mb-3 grid size-12 place-items-center rounded-full bg-background-secondary-default text-text-tertiary">
                  <RiUsbLine className="size-6" aria-hidden />
                </span>
                <p className="text-body-2-medium text-text-secondary">
                  {p.scanning || p.picking
                    ? p.pickProgress || "正在寻找录像"
                    : p.drive
                      ? "没有匹配的录像"
                      : "插上 U 盘，或选择文件夹"}
                </p>
                <p className="mt-1.5 max-w-xs text-caption-1-regular text-text-tertiary">
                  {p.drive
                    ? "试试其他时间或录像分类"
                    : "iPhone：在「文件」打开 U 盘（常为 NO NAME），选中整个盘或 driverecord 后回来授权。"}
                </p>
                {!p.drive && (!p.scanning || p.picking) && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <Button leadingIcon={RiFolderOpenLine} onClick={p.onPickFolder}>
                      {p.picking ? "取消选择" : "选择 U 盘/文件夹"}
                    </Button>
                    {p.onPickFiles && !p.picking ? (
                      <Button
                        variant="secondary"
                        leadingIcon={RiFolderOpenLine}
                        onClick={p.onPickFiles}
                      >
                        多选录像文件
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
