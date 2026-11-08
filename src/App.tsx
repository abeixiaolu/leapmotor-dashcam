import { useMatch, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiErrorWarningLine,
  RiGridLine,
  RiLayoutRightLine,
  RiMenuLine,
  RiPauseFill,
  RiPlayFill,
  RiRefreshLine,
  RiRewindFill,
  RiSkipBackFill,
  RiSkipForwardFill,
  RiEqualizerLine,
  RiForward10Fill,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiVideoLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Drawer, DrawerBody, DrawerHeader } from "@/components/base/drawer/drawer";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { Spinner } from "@/components/base/spinner/spinner";
import { PlayerSlider, PlaybackSpeed, CorrectionSwitch } from "./components/PlayerControls";
import { MosaicPlayer, type MosaicPlayerHandle } from "./MosaicPlayer";
import { clock } from "./library";
import type { Direction } from "./library";
import { HelpDialog } from "./components/HelpDialog";
import { RecordingList } from "./components/RecordingList";
import { dateCounts, dayKey } from "./calendar";
import { cx } from "@/utils/cx";
import {
  abortDirectoryPick,
  buildDriveFromFiles,
  describeScanFailure,
  iosDirectoryUploadLikelySupported,
  isLikelyMobileSafari,
  pickDirectoryFiles,
  pickRecordingFiles,
  uploadLocalRecording,
} from "./localFolder";

export type Recording = {
  id: string;
  name: string;
  stamp: string;
  kind: "drive" | "sentinel";
  size: number;
  duration?: number;
};
export type Drive = { id: string; name: string; recordings: Recording[] };
type Prepared = {
  status: "preparing" | "ready" | "error";
  url?: string;
  error?: string;
  duration?: number;
};

const DESKTOP_MQ = "(min-width: 768px) and (min-height: 600px)";

export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]),
    [driveId, setDriveId] = useState(""),
    [listSelected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<"drive" | "sentinel">("drive");
  const [scanning, setScanning] = useState(true),
    [scanError, setScanError] = useState(""),
    [status, setStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle"),
    [error, setError] = useState(""),
    [src, setSrc] = useState(""),
    [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [seek, setSeek] = useState({ time: 0, token: 0 });
  const [correct, setCorrect] = useState(true),
    [fov, setFov] = useState(95),
    [strength, setStrength] = useState(1),
    [layout, setLayout] = useState<"focus" | "grid">("focus"),
    [primary, setPrimary] = useState<Direction>("front"),
    [help, setHelp] = useState(false),
    [tuneOpen, setTuneOpen] = useState(false),
    [drawerOpen, setDrawerOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickProgress, setPickProgress] = useState("");
  const [sourceMode, setSourceMode] = useState<"auto" | "local">("auto");
  const localFilesRef = useRef<Map<string, File>>(new Map());
  const mosaicRef = useRef<MosaicPlayerHandle>(null);
  const [stage, setStage] = useState(false);
  const uploadedRef = useRef<Set<string>>(new Set());
  const pickGenRef = useRef(0);
  const [selectedDate, setSelectedDate] = useState("");
  const match = useMatch({ from: "/recordings/$recordingId", shouldThrow: false });
  const navigate = useNavigate();
  const page = match ? "detail" : "list";
  const selected = match?.params.recordingId ?? listSelected;

  useEffect(() => {
    if (!match) return;
    const matchingDrive = drives.find((item) =>
      item.recordings.some((recording) => recording.id === match.params.recordingId),
    );
    const recording = matchingDrive?.recordings.find(
      (item) => item.id === match.params.recordingId,
    );
    if (matchingDrive && recording) {
      setDriveId(matchingDrive.id);
      setKind(recording.kind);
      setSelectedDate(dayKey(recording.stamp));
      setSelected(recording.id);
    }
  }, [drives, match]);

  useEffect(() => {
    if (!help) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [help]);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const scanningRef = useRef(false);
  const drive = drives.find((d) => d.id === driveId) || drives[0];
  const records = useMemo(() => drive?.recordings || [], [drive]);
  const counts = useMemo(() => dateCounts(records, kind), [records, kind]);
  const date = counts.has(selectedDate) ? selectedDate : [...counts.keys()].sort().at(-1) || "";
  const datedRecords = useMemo(
    () => records.filter((r) => r.kind === kind && dayKey(r.stamp) === date),
    [records, kind, date],
  );
  const clip = records.find((r) => r.id === selected);
  const shown = useMemo(
    () =>
      datedRecords.filter((r) =>
        `${r.name} ${r.stamp}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [datedRecords, query],
  );
  const scan = useCallback(async () => {
    if (sourceMode === "local") return;
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const response = await fetch("/api/drives", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        drives?: Drive[];
        error?: string;
      };
      if (!response.ok) {
        setDrives([]);
        setScanError(describeScanFailure(response.status, data.error));
        return;
      }
      setDrives(data.drives || []);
      setScanError(data.error || "");
      setSourceMode("auto");
    } catch {
      setDrives([]);
      setScanError(describeScanFailure(0));
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, [sourceMode]);
  const pickAbortRef = useRef<AbortController | null>(null);
  const cancelFolderPick = useCallback(() => {
    pickGenRef.current += 1;
    try {
      pickAbortRef.current?.abort();
    } catch {
      /* ignore */
    }
    pickAbortRef.current = null;
    abortDirectoryPick();
    setPicking(false);
    setPickProgress("");
    setScanError(
      "已取消选择。请再点「选择文件夹」或「多选录像文件」，在「文件」中打开 U 盘后授权。",
    );
  }, []);
  const applyPickedFiles = useCallback(
    async (files: File[], gen: number, ac: AbortController) => {
      if (gen !== pickGenRef.current || ac.signal.aborted) return;
      if (!files.length) {
        setPickProgress("");
        if (isLikelyMobileSafari() && !iosDirectoryUploadLikelySupported()) {
          setScanError(
            "未读到文件。当前 iOS 低于 18.4 时，Safari「选择文件夹」往往无法授权整个目录。请点「多选录像文件」，在「文件」进入 U 盘 driverecord 多选 .h264；或把 U 盘插在电脑上用自动扫描。",
          );
        } else {
          setScanError(
            "未选择文件夹，或系统没有把文件交回页面。请再试：在「文件」打开 U 盘（常见名「NO NAME」），选整个盘或 driverecord 后点「打开」；仍不行请用「多选录像文件」。",
          );
        }
        return;
      }
      setPickProgress(`正在识别 ${files.length} 个文件…`);
      const { drive, fileMap } = await buildDriveFromFiles(files);
      if (gen !== pickGenRef.current || ac.signal.aborted) return;
      localFilesRef.current = fileMap;
      uploadedRef.current = new Set();
      setDrives([drive]);
      setDriveId(drive.id);
      setSourceMode("local");
      setScanError("");
      setPickProgress("");
      setSelected("");
      setSelectedDate("");
      void navigate({ to: "/" });
    },
    [navigate],
  );

  const beginPick = useCallback(
    (mode: "directory" | "files") => {
      // While picking: shared buttons become「取消选择」— abort live waiter, do not open another sheet.
      if (picking) {
        cancelFolderPick();
        return;
      }
      const gen = ++pickGenRef.current;
      const ac = new AbortController();
      pickAbortRef.current = ac;
      setPicking(true);
      setPickProgress(mode === "files" ? "等待选择录像文件…" : "等待选择文件夹…");
      setScanError("");

      const finish = async (files: File[]) => {
        try {
          await applyPickedFiles(files, gen, ac);
        } catch (error) {
          if (gen !== pickGenRef.current || ac.signal.aborted) return;
          setPickProgress("");
          setScanError(error instanceof Error ? error.message : "选择失败。");
        } finally {
          if (gen === pickGenRef.current) {
            setPicking(false);
            setPickProgress("");
            if (pickAbortRef.current === ac) pickAbortRef.current = null;
          }
        }
      };

      const waitOpts = {
        onReturn: () => {
          if (gen !== pickGenRef.current || ac.signal.aborted) return;
          setPickProgress(mode === "files" ? "正在读取所选文件…" : "正在读取所选文件夹…");
        },
      };

      // Must open the system sheet in THIS user-gesture turn (no await before click).
      const opener =
        mode === "files"
          ? pickRecordingFiles(ac.signal, waitOpts)
          : pickDirectoryFiles(ac.signal, waitOpts);
      void opener.then(finish).catch((error: unknown) => {
        if (gen !== pickGenRef.current || ac.signal.aborted) return;
        setPicking(false);
        setPickProgress("");
        setScanError(error instanceof Error ? error.message : "无法打开选择器。");
        if (pickAbortRef.current === ac) pickAbortRef.current = null;
      });
    },
    [picking, cancelFolderPick, applyPickedFiles],
  );

  const pickFolder = useCallback(() => beginPick("directory"), [beginPick]);
  const pickFiles = useCallback(() => beginPick("files"), [beginPick]);
  useEffect(() => {
    if (sourceMode === "local") return;
    void scan();
    const timer = setInterval(() => void scan(), 8000);
    return () => clearInterval(timer);
  }, [scan, sourceMode]);
  useEffect(() => {
    if (page === "list" && !datedRecords.some((r) => r.id === selected)) {
      setSelected(datedRecords[0]?.id || "");
      setPlaying(false);
    }
  }, [datedRecords, selected, page]);
  useEffect(() => {
    setPlaying(false);
    setSrc("");
    setSeek((old) => ({ time: 0, token: old.token + 1 }));
    setTime(0);
    setDuration(0);
    setError("");
    if (!selected || page !== "detail") {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus("preparing");
    const prepare = async (start: boolean) => {
      try {
        const localFile = localFilesRef.current.get(selected);
        if (localFile && start && !uploadedRef.current.has(selected)) {
          setPickProgress("正在把录像传到电脑处理…");
          await uploadLocalRecording(selected, localFile, (ratio) => {
            if (controller.signal.aborted) return;
            setPickProgress(`正在上传 ${(ratio * 100).toFixed(0)}%…`);
          });
          if (controller.signal.aborted) return;
          uploadedRef.current.add(selected);
          setPickProgress("正在封装可播放格式…");
        }
        const response = await fetch(`/api/recordings/${encodeURIComponent(selected)}/prepare`, {
          method: start ? "POST" : "GET",
          signal: controller.signal,
        });
        const data = (await response.json()) as Prepared;
        if (!response.ok || data.status === "error")
          throw Error(data.error || "这段录像暂时无法读取");
        if (controller.signal.aborted) return;
        if (data.status === "ready" && data.url) {
          setSrc(data.url);
          setStatus("ready");
          setPickProgress("");
          if (data.duration) setDuration(data.duration);
        } else {
          timer = setTimeout(() => void prepare(false), 700);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setPickProgress("");
        setError(e instanceof Error ? e.message : "读取录像失败");
      }
    };
    void prepare(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected, retry, page]);

  const choose = (id: string) => {
    void navigate({ to: "/recordings/$recordingId", params: { recordingId: id } });
    setDrawerOpen(false);
    if (id !== selected) {
      setPlaying(false);
      setSelected(id);
    }
  };
  const jump = (t: number) => {
    const next = Math.max(0, Math.min(duration, t));
    setTime(next);
    setSeek((old) => ({ time: next, token: old.token + 1 }));
  };
  const toggle = () => {
    if (status !== "ready" || !duration) return;
    if (time >= duration - 0.05) jump(0);
    setPlaying((v) => !v);
  };
  const adjacent = (offset: number) => {
    const i = shown.findIndex((r) => r.id === selected) + offset;
    if (shown[i]) choose(shown[i].id);
  };
  const report = useCallback((message: string) => {
    setError(message);
    setPlaying(false);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,select,button,textarea,[role=slider],[role=listbox]",
        )
      )
        return;
      if (e.key === "Escape") setHelp(false);
      if (e.code === "Space" && status === "ready") {
        e.preventDefault();
        if (time >= duration - 0.05) jump(0);
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [status, time, duration]);
  const selectedIndex = shown.findIndex((r) => r.id === selected);

  const listProps = {
    drives,
    drive,
    records,
    shown,
    kind,
    setKind,
    setDriveId,
    date,
    counts,
    query,
    setQuery,
    scanning,
    scanError,
    selectedId: page === "detail" ? selected : "",
    onDate: (next: string) => {
      setSelectedDate(next);
      setQuery("");
    },
    onChoose: choose,
    onScan: () => {
      if (sourceMode === "local") {
        setSourceMode("auto");
        localFilesRef.current = new Map();
        uploadedRef.current = new Set();
      }
      void scan();
    },
    onPickFolder: pickFolder,
    // iPhone-only fallback: webkitdirectory is unreliable before iOS 18.4 / on some USB grants
    onPickFiles: isLikelyMobileSafari() ? pickFiles : undefined,
    picking,
    pickProgress,
    sourceMode,
    onHelp: () => setHelp(true),
  };

  return (
    <div className="app app-shell flex min-h-dvh bg-background-full">
      {/* Desktop / wide: persistent left list */}
      <aside className="app-sidebar hidden w-[22rem] shrink-0 flex-col border-r border-separator-border bg-background-full desktop:flex lg:w-[26rem]">
        <RecordingList {...listProps} />
      </aside>

      {/* Phone / narrow: list as BoardUI drawer */}
      <Drawer
        placement="start"
        size="md"
        isOpen={drawerOpen}
        onOpenChange={setDrawerOpen}
        aria-label="录像列表"
        className="!gap-0 !py-0"
      >
        {() => (
          <>
            <DrawerHeader
              title="录像列表"
              description="选择一段录像开始回放。"
              closeLabel="关闭列表"
            />
            <DrawerBody className="!px-0 !py-0">
              <RecordingList {...listProps} hideBrand className="min-h-[70dvh]" />
            </DrawerBody>
          </>
        )}
      </Drawer>

      <main className="detail-page flex min-h-dvh min-w-0 flex-1 flex-col bg-background-full">
        <header className="detail-header sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-separator-border bg-background-primary-default/90 px-3 backdrop-blur-md supports-[padding:max(0px)]:pt-[env(safe-area-inset-top)] sm:h-14 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RiMenuLine}
              className="desktop:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              录像列表
            </Button>
            <span className="hidden truncate text-body-2-regular text-text-secondary desktop:inline">
              {clip?.stamp || "选择左侧录像开始回放"}
            </span>
            <span className="truncate text-body-2-regular text-text-secondary desktop:hidden">
              {clip?.stamp || "全景回放"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="small"
            className="hidden sm:inline-flex desktop:hidden"
            onClick={() => setHelp(true)}
          >
            指南
          </Button>
        </header>

        <div className="detail-content mx-auto flex w-full max-w-[94rem] flex-1 flex-col gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:gap-4 sm:px-5 sm:pt-5">
          <div className="viewer-heading flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-title-3-semibold text-text-primary">全景回放</h2>
              <span className="hidden rounded-md border border-separator-border px-2 py-0.5 text-caption-1-medium text-text-tertiary sm:inline">
                同源帧同步
              </span>
            </div>
            <SegmentedControl
              selectedKeys={new Set([layout])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next === "focus" || next === "grid") setLayout(next);
              }}
              aria-label="画面布局"
            >
              <SegmentedControlItem id="focus" aria-label="主画面加三路预览">
                <RiLayoutRightLine className="size-4" aria-hidden />
                <span className="ms-1 hidden sm:inline">主视角</span>
              </SegmentedControlItem>
              <SegmentedControlItem id="grid" aria-label="四宫格布局">
                <RiGridLine className="size-4" aria-hidden />
                <span className="ms-1 hidden sm:inline">四宫格</span>
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          <div className="player overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-card">
            {src ? (
              <MosaicPlayer
                ref={mosaicRef}
                src={src}
                playing={playing}
                rate={rate}
                seek={seek}
                correct={correct}
                fov={fov}
                strength={strength}
                layout={layout}
                primary={primary}
                onPrimary={setPrimary}
                onTime={setTime}
                onDuration={setDuration}
                onPlaying={setPlaying}
                onError={report}
                onStageChange={setStage}
              />
            ) : (
              <div className="player-placeholder flex min-h-[min(52vh,24rem)] flex-col items-center justify-center gap-4 px-6 py-10 text-center text-neutral-400">
                {status === "preparing" ? (
                  <Spinner size="lg" className="text-accent-400" />
                ) : (
                  <RiVideoLine className="size-9" aria-hidden />
                )}
                <b className="text-title-3-medium text-neutral-200">
                  {status === "preparing"
                    ? "正在准备原始录像"
                    : status === "error"
                      ? "这段录像暂时无法播放"
                      : page === "list"
                        ? "从列表选择一段录像"
                        : "旅途，即将呈现"}
                </b>
                <p className="max-w-sm text-body-2-regular text-neutral-400">
                  {status === "preparing"
                    ? pickProgress || "首次打开会在电脑建立播放缓存，U 盘原文件保持不变。"
                    : status === "error"
                      ? error
                      : page === "list"
                        ? "宽屏左侧直接点选；手机点左上角「录像列表」打开抽屉。iPhone 可点「选择文件夹」从「文件」授权 U 盘。"
                        : "连接零跑 U 盘后，自动读取四路影像；手机请用「选择文件夹」。"}
                </p>
                {page === "list" && (
                  <Button
                    leadingIcon={RiMenuLine}
                    className="desktop:hidden"
                    onClick={() => setDrawerOpen(true)}
                  >
                    打开录像列表
                  </Button>
                )}
                {status === "error" && (
                  <Button leadingIcon={RiRefreshLine} onClick={() => setRetry((n) => n + 1)}>
                    重新读取
                  </Button>
                )}
              </div>
            )}

            <div className="transport border-t border-neutral-800 bg-neutral-900 px-3 py-3 text-neutral-300 sm:px-5">
              <div className="timeline flex items-center gap-3 font-mono text-caption-1-medium tabular-nums">
                <span className="min-w-[3rem]">{clock(time)}</span>
                <PlayerSlider
                  label="播放进度"
                  min={0}
                  max={duration || 1}
                  step={0.04}
                  value={Math.min(time, duration || 1)}
                  disabled={status !== "ready" || !duration}
                  onChange={jump}
                  className="timeline-slider flex-1"
                />
                <span className="min-w-[3rem] text-end">{clock(duration)}</span>
              </div>
              <div className="transport-row mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="transport-status hidden items-center gap-2 text-caption-1-regular text-neutral-400 md:flex">
                  <span
                    className={cx(
                      "inline-block size-1.5 rounded-full",
                      playing ? "bg-accent-400" : "bg-neutral-500",
                    )}
                  />
                  {playing ? "四路同步播放" : clip ? clip.stamp : "等待载入录像"}
                </div>
                <div className="play-actions mx-auto flex items-center gap-1 sm:gap-2">
                  <IconButton
                    aria-label="上一段"
                    size="small"
                    className="transport-icon-btn"
                    icon={RiSkipBackFill}
                    disabled={selectedIndex <= 0}
                    onClick={() => adjacent(-1)}
                  />
                  <IconButton
                    aria-label="后退十秒"
                    size="small"
                    className="transport-icon-btn"
                    icon={RiRewindFill}
                    disabled={!duration || status !== "ready"}
                    onClick={() => jump(time - 10)}
                  />
                  <Button
                    aria-label={playing ? "暂停" : "播放"}
                    className="!size-11 !rounded-full !p-0"
                    disabled={!duration || status !== "ready"}
                    onClick={toggle}
                    leadingIcon={playing ? RiPauseFill : RiPlayFill}
                    iconOnly
                  />
                  <IconButton
                    aria-label="前进十秒"
                    size="small"
                    className="transport-icon-btn"
                    icon={RiForward10Fill}
                    disabled={!duration || status !== "ready"}
                    onClick={() => jump(time + 10)}
                  />
                  <IconButton
                    aria-label="下一段"
                    size="small"
                    className="transport-icon-btn"
                    icon={RiSkipForwardFill}
                    disabled={selectedIndex < 0 || selectedIndex >= shown.length - 1}
                    onClick={() => adjacent(1)}
                  />
                </div>
                <div className="flex items-center gap-2 ms-auto md:ms-0">
                  <IconButton
                    aria-label={stage ? "退出放大" : "放大"}
                    size="small"
                    className="transport-icon-btn"
                    icon={stage ? RiFullscreenExitLine : RiFullscreenLine}
                    disabled={status !== "ready"}
                    onClick={() => {
                      if (stage) mosaicRef.current?.exitStage();
                      else mosaicRef.current?.enterStage();
                    }}
                  />
                  <div className="speed">
                    <PlaybackSpeed value={rate} onChange={setRate} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section
            className={cx(
              "correction rounded-2xl border border-separator-border bg-background-primary-default shadow-card",
              "detail-correction",
            )}
          >
            <div className="correction-toggle flex w-full items-center gap-3 px-4 py-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-start sm:pointer-events-none"
                onClick={() => setTuneOpen((v) => !v)}
                aria-expanded={tuneOpen}
              >
                <span className="grid size-9 place-items-center rounded-2lg bg-background-secondary-default text-text-secondary">
                  <RiEqualizerLine className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-medium text-text-primary">鱼眼画面校正</span>
                  <span className="block text-caption-1-regular text-text-tertiary">
                    四路独立校正 · 自然视角
                  </span>
                </span>
              </button>
              <CorrectionSwitch
                checked={correct}
                onChange={(next) => {
                  setCorrect(next);
                  if (next) setTuneOpen(true);
                }}
              />
            </div>
            <div
              className={cx(
                "correction-body grid gap-4 border-t border-separator-border px-4 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center",
                !tuneOpen && "max-sm:hidden",
              )}
            >
              <label
                className={cx(
                  "flex items-center gap-3 text-body-2-regular text-text-secondary",
                  !correct && "opacity-50",
                )}
              >
                <span className="shrink-0">视野角度</span>
                <PlayerSlider
                  label="视野角度"
                  min={60}
                  max={130}
                  value={fov}
                  onChange={setFov}
                  disabled={!correct}
                  showTooltip
                  className="flex-1"
                />
                <b className="min-w-10 text-end text-body-2-medium text-text-primary">{fov}°</b>
              </label>
              <label
                className={cx(
                  "flex items-center gap-3 text-body-2-regular text-text-secondary",
                  !correct && "opacity-50",
                )}
              >
                <span className="shrink-0">校正强度</span>
                <PlayerSlider
                  label="校正强度"
                  min={0}
                  max={1}
                  step={0.01}
                  value={strength}
                  onChange={setStrength}
                  disabled={!correct}
                  showTooltip
                  className="flex-1"
                />
                <b className="min-w-10 text-end text-body-2-medium text-text-primary">
                  {Math.round(strength * 100)}%
                </b>
              </label>
              <Button
                variant="secondary"
                size="small"
                leadingIcon={RiRefreshLine}
                aria-label="重置校正参数"
                onClick={() => {
                  setFov(95);
                  setStrength(1);
                }}
              >
                重置
              </Button>
            </div>
          </section>

          {error && status !== "error" && (
            <div
              className="flex items-center gap-3 rounded-2lg border border-status-yellow-background bg-status-yellow-background px-3 py-3 text-body-2-regular text-status-yellow-text"
              role="alert"
            >
              <RiErrorWarningLine className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{error}</span>
              <Button size="xs" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
                重试
              </Button>
            </div>
          )}
        </div>
      </main>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
