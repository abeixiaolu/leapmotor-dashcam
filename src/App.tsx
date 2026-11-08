import { MotionText, PlaybackIcon, FullscreenIcon, changeCameraLayout } from "@/components/Motion";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { default as RiErrorWarningLine } from "@carbon/icons-react/es/WarningAlt.js";
import { default as RiMenuLine } from "@carbon/icons-react/es/Menu.js";
import { default as RiRefreshLine } from "@carbon/icons-react/es/Renew.js";
import { default as RiRewindFill } from "@carbon/icons-react/es/Rewind_10.js";
import { default as RiSkipBackFill } from "@carbon/icons-react/es/SkipBack.js";
import { default as RiSkipForwardFill } from "@carbon/icons-react/es/SkipForward.js";
import { default as RiForward10Fill } from "@carbon/icons-react/es/Forward_10.js";
import { default as RiVideoLine } from "@carbon/icons-react/es/Video.js";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Drawer, DrawerBody, DrawerHeader } from "@/components/base/drawer/drawer";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { default as RiGridLine } from "@carbon/icons-react/es/Grid.js";
import { default as RiLayoutRightLine } from "@carbon/icons-react/es/ViewMode_1.js";
import { default as RiEqualizerLine } from "@carbon/icons-react/es/SettingsAdjust.js";
import { Spinner } from "@/components/base/spinner/spinner";
import { PlayerSlider, PlaybackSpeed } from "./components/PlayerControls";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { readCorrectionSettings, saveCorrectionSettings } from "@/settings";
import { MosaicPlayer } from "./MosaicPlayer";
import { clock } from "./library";
import type { Direction } from "./library";
import { HelpDialog } from "./components/HelpDialog";
import { RecordingList } from "./components/RecordingList";
import { dateCounts, dayKey } from "./calendar";
import { cx } from "@/utils/cx";
import {
  abortDirectoryPick,
  buildDriveFromFiles,
  iosDirectoryUploadLikelySupported,
  isLikelyMobileSafari,
  pickDirectoryFiles,
  pickRecordingFiles,
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
const DESKTOP_MQ = "(min-width: 768px) and (min-height: 600px)";

export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]),
    [driveId, setDriveId] = useState(""),
    [listSelected, setSelected] = useState(""),
    [kind, setKind] = useState<"drive" | "sentinel">("drive");
  const [scanError, setScanError] = useState(""),
    [status, setStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle"),
    [error, setError] = useState(""),
    [src, setSrc] = useState(""),
    [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [seek, setSeek] = useState({ time: 0, token: 0 });
  const [settings, setSettings] = useState(readCorrectionSettings);
  const { correct, fov, strength } = settings;
  const [settingsSaved, setSettingsSaved] = useState(true);
  useEffect(() => {
    setSettingsSaved(saveCorrectionSettings(settings));
  }, [settings]);
  const [layout, setLayout] = useState<"focus" | "grid">("focus"),
    [primary, setPrimary] = useState<Direction>("front"),
    [help, setHelp] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [drawerOpen, setDrawerOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickProgress, setPickProgress] = useState("");
  const localFilesRef = useRef<Map<string, File>>(new Map());
  const playerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(false);
  const exitStage = useCallback(() => {
    setStage(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const syncFullscreen = () => setStage(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    if (!stage) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) exitStage();
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
    };
  }, [stage, exitStage]);

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

  const drive = drives.find((d) => d.id === driveId) || drives[0];
  const records = useMemo(() => drive?.recordings || [], [drive]);
  const counts = useMemo(() => dateCounts(records, kind), [records, kind]);
  const date = counts.has(selectedDate) ? selectedDate : [...counts.keys()].sort().at(-1) || "";
  const datedRecords = useMemo(
    () => records.filter((r) => r.kind === kind && dayKey(r.stamp) === date),
    [records, kind, date],
  );
  const clip = page === "detail" ? records.find((r) => r.id === selected) : undefined;
  const shown = datedRecords;
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
            "未读到文件。当前 iOS 低于 18.4 时，Safari「选择文件夹」往往无法授权整个目录。请点「多选录像文件」，在「文件」进入 U 盘 driverecord 多选 .h264。",
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
      setDrives([drive]);
      setDriveId(drive.id);
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
    setPickProgress("");
    if (!selected || page !== "detail") {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    let objectURL: string | undefined;
    setStatus("preparing");
    const prepare = async () => {
      try {
        const localFile = localFilesRef.current.get(selected);
        if (!localFile)
          throw new Error("请重新选择包含这段录像的文件夹。刷新页面后需要重新授权读取。");
        const { prepareRecording } = await import("./media/prepare");
        controller.signal.throwIfAborted();
        const blob = await prepareRecording(localFile, controller.signal, (text) => {
          if (!controller.signal.aborted) setPickProgress(text);
        });
        if (controller.signal.aborted) return;
        objectURL = URL.createObjectURL(blob);
        setSrc(objectURL);
        setStatus("ready");
        setPickProgress("");
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setPickProgress("");
        setError(e instanceof Error ? e.message : "读取录像失败");
      }
    };
    void prepare();
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
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
  const selectedIndex = page === "detail" ? shown.findIndex((r) => r.id === selected) : -1;

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
    scanError,
    selectedId: page === "detail" ? selected : "",
    onDate: (next: string) => {
      setSelectedDate(next);
    },
    onChoose: choose,
    onPickFolder: pickFolder,
    onPickFiles: pickFiles,
    picking,
    pickProgress,
    onHelp: () => setHelp(true),
  };

  const layoutControl = (
    <SegmentedControl
      selectedKeys={new Set([layout])}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === "focus" || next === "grid") changeCameraLayout(() => setLayout(next));
      }}
      aria-label="画面布局"
    >
      <SegmentedControlItem id="focus" aria-label="主画面加三路预览">
        <RiLayoutRightLine className="size-4" aria-hidden />
        <span className="ms-1 hidden desktop:inline">主视角</span>
      </SegmentedControlItem>
      <SegmentedControlItem id="grid" aria-label="四宫格布局">
        <RiGridLine className="size-4" aria-hidden />
        <span className="ms-1 hidden desktop:inline">四宫格</span>
      </SegmentedControlItem>
    </SegmentedControl>
  );

  return (
    <div className="app app-shell flex min-h-dvh bg-background-primary-default">
      {/* Desktop / wide: persistent left list */}
      <aside className="app-sidebar sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-e border-separator-border bg-background-primary-default desktop:flex">
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
              className="drawer-panel-header"
            />
            <DrawerBody className="!px-0 !py-0">
              <RecordingList {...listProps} hideBrand className="h-full" />
            </DrawerBody>
          </>
        )}
      </Drawer>

      <main className="detail-page flex min-h-dvh min-w-0 flex-1 flex-col bg-background-primary-default">
        <header className="detail-header sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator-border bg-background-primary-default/90 px-3 backdrop-blur-md supports-[padding:max(0px)]:pt-[env(safe-area-inset-top)] sm:h-14 sm:px-5">
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
              <MotionText>{clip?.stamp || "选择左侧录像开始回放"}</MotionText>
            </span>
            <span className="hidden truncate text-body-2-regular text-text-secondary sm:inline desktop:hidden">
              <MotionText>{clip?.stamp || "未选择录像"}</MotionText>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {layoutControl}
            <Button
              variant="ghost"
              size="small"
              className="hidden sm:inline-flex desktop:hidden"
              onClick={() => setHelp(true)}
            >
              指南
            </Button>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RiEqualizerLine}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              设置
            </Button>
          </div>
        </header>

        <div className="detail-content mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 sm:pt-6">
          <div
            ref={playerRef}
            className={cx(
              "player overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default",
              stage && "is-stage-fullscreen",
            )}
          >
            {src ? (
              <MosaicPlayer
                src={src}
                playing={playing}
                rate={rate}
                seek={seek}
                correct={correct}
                fov={fov}
                strength={strength}
                layout={layout}
                primary={primary}
                onPrimary={(next) => changeCameraLayout(() => setPrimary(next))}
                onTime={setTime}
                onDuration={setDuration}
                onPlaying={setPlaying}
                onError={report}
              />
            ) : (
              <div
                key={status}
                className="motion-enter player-placeholder flex min-h-80 flex-col items-center justify-center gap-4 bg-background-secondary-default px-6 py-10 text-center text-text-tertiary"
              >
                {status === "preparing" ? (
                  <Spinner size="lg" className="text-accent-400" />
                ) : (
                  <RiVideoLine className="size-9" aria-hidden />
                )}
                <b className="text-title-3-medium text-text-primary">
                  {status === "preparing"
                    ? "正在准备原始录像"
                    : status === "error"
                      ? "这段录像暂时无法播放"
                      : page === "list"
                        ? "从列表选择一段录像"
                        : "尚未找到这段录像"}
                </b>
                <p className="max-w-sm text-body-2-regular text-text-secondary">
                  {status === "preparing"
                    ? pickProgress || "正在浏览器中处理，U 盘原文件保持不变。"
                    : status === "error"
                      ? error
                      : page === "list"
                        ? "按日期或时间找到录像，一次查看前、后、左、右四路影像。"
                        : "请打开录像列表，选择 U 盘文件夹或录像文件。"}
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

            <div className="transport border-t border-separator-border bg-background-primary-default px-4 py-3 text-text-secondary">
              <div className="timeline flex items-center gap-3 text-caption-1-medium tabular-nums">
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
                    className="control-square !p-0"
                    disabled={!duration || status !== "ready"}
                    onClick={toggle}
                  >
                    <PlaybackIcon playing={playing} />
                  </Button>
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
                  <Button
                    variant="ghost"
                    aria-label={stage ? "退出放大" : "放大"}
                    size="small"
                    className="transport-icon-btn"
                    disabled={!stage && status !== "ready"}
                    onClick={() => {
                      if (stage) exitStage();
                      else {
                        setStage(true);
                        void playerRef.current?.requestFullscreen?.().catch(() => {});
                      }
                    }}
                  >
                    <FullscreenIcon expanded={stage} />
                  </Button>
                  <div className="speed">
                    <PlaybackSpeed
                      value={rate}
                      onChange={setRate}
                      portalContainer={stage ? (playerRef.current ?? undefined) : undefined}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && status !== "error" && (
            <div
              className="motion-enter flex items-center gap-3 rounded-2lg border border-status-yellow-background bg-status-yellow-background px-3 py-3 text-body-2-regular text-status-yellow-text"
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
      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onChange={setSettings}
        saved={settingsSaved}
      />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
