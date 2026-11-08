import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
  LayoutGrid,
  PanelsTopLeft,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Video,
  RotateCcw,
  LoaderCircle,
  Rewind10,
  Forward10,
} from "./icons";
import { PlayerSlider, PlaybackSpeed, CorrectionSwitch } from "./components/PlayerControls";
import { MosaicPlayer } from "./MosaicPlayer";
import { clock } from "./library";
import type { Direction } from "./library";
import "./style.css";
import { HelpDialog } from "./components/HelpDialog";
import { RecordingList } from "./components/RecordingList";
import { dateCounts, dayKey } from "./calendar";
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
export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]),
    [driveId, setDriveId] = useState(""),
    [selected, setSelected] = useState(""),
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
    [help, setHelp] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [page, setPage] = useState<"list" | "detail">("list");
  useEffect(() => {
    if (!help) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelp(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [help]);
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
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const response = await fetch("/api/drives", { cache: "no-store" });
      if (!response.ok) throw Error("本地读取服务暂时不可用");
      const data = (await response.json()) as { drives: Drive[]; error?: string };
      setDrives(data.drives || []);
      setScanError(data.error || "");
    } catch {
      setScanError("无法连接本地读取服务，请确认应用正在运行。");
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, []);
  useEffect(() => {
    void scan();
    const timer = setInterval(() => void scan(), 8000);
    return () => clearInterval(timer);
  }, [scan]);
  useEffect(() => {
    if (!datedRecords.some((r) => r.id === selected)) {
      setSelected(datedRecords[0]?.id || "");
      setPlaying(false);
    }
  }, [datedRecords, selected]);
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
          if (data.duration) setDuration(data.duration);
        } else {
          timer = setTimeout(() => void prepare(false), 700);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus("error");
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
    setPage("detail");
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
  return (
    <div className="app app-pages">
      {page === "list" ? (
        <RecordingList
          drives={drives}
          drive={drive}
          records={records}
          shown={shown}
          kind={kind}
          setKind={setKind}
          setDriveId={setDriveId}
          date={date}
          counts={counts}
          query={query}
          setQuery={setQuery}
          scanning={scanning}
          scanError={scanError}
          onDate={(next) => {
            setSelectedDate(next);
            setQuery("");
          }}
          onChoose={choose}
          onScan={() => void scan()}
          onHelp={() => setHelp(true)}
        />
      ) : (
        <main>
          <header className="detail-header">
            <button
              className="back-button"
              onClick={() => {
                setPlaying(false);
                setPage("list");
              }}
            >
              ← 返回录像列表
            </button>
            <span>{clip?.stamp || "录像详情"}</span>
          </header>
          <div className="content">
            <div className="viewer-heading">
              <div>
                <h2>全景回放</h2>
                <span className="tag">同源帧同步</span>
              </div>
              <div className="layout-buttons">
                <button
                  aria-label="主画面加三路预览"
                  aria-pressed={layout === "focus"}
                  className={layout === "focus" ? "selected" : ""}
                  onClick={() => setLayout("focus")}
                >
                  <PanelsTopLeft size={15} />
                  <span>主视角</span>
                </button>
                <button
                  aria-label="四宫格布局"
                  aria-pressed={layout === "grid"}
                  className={layout === "grid" ? "selected" : ""}
                  onClick={() => setLayout("grid")}
                >
                  <LayoutGrid size={15} />
                  <span>四宫格</span>
                </button>
              </div>
            </div>
            <div className="player">
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
                  onPrimary={setPrimary}
                  onTime={setTime}
                  onDuration={setDuration}
                  onPlaying={setPlaying}
                  onError={report}
                />
              ) : (
                <div className="player-placeholder">
                  {status === "preparing" ? (
                    <LoaderCircle size={35} className="spinning" />
                  ) : (
                    <Video size={35} />
                  )}
                  <b>
                    {status === "preparing"
                      ? "正在准备原始录像"
                      : status === "error"
                        ? "这段录像暂时无法播放"
                        : "旅途，即将呈现"}
                  </b>
                  <p>
                    {status === "preparing"
                      ? "首次打开会在电脑建立播放缓存，U 盘原文件保持不变。"
                      : status === "error"
                        ? error
                        : "连接零跑 U 盘后，自动读取四路影像。"}
                  </p>
                  {status === "error" && (
                    <button className="primary" onClick={() => setRetry((n) => n + 1)}>
                      重新读取
                    </button>
                  )}
                </div>
              )}
              <div className="transport">
                <div className="timeline">
                  <span>{clock(time)}</span>
                  <PlayerSlider
                    label="播放进度"
                    min={0}
                    max={duration || 1}
                    step={0.04}
                    value={Math.min(time, duration || 1)}
                    disabled={status !== "ready" || !duration}
                    onChange={jump}
                  />
                  <span>{clock(duration)}</span>
                </div>
                <div className="transport-row">
                  <div className="transport-status">
                    <span className={playing ? "green-dot" : "gray-dot"} />
                    {playing ? "四路同步播放" : clip ? clip.stamp : "等待载入录像"}
                  </div>
                  <div className="play-actions">
                    <button
                      disabled={selectedIndex <= 0}
                      aria-label="上一段"
                      onClick={() => adjacent(-1)}
                    >
                      <SkipBack size={17} />
                    </button>
                    <button
                      disabled={!duration || status !== "ready"}
                      aria-label="后退十秒"
                      onClick={() => jump(time - 10)}
                    >
                      <Rewind10 size={24} />
                    </button>
                    <button
                      className="play"
                      disabled={!duration || status !== "ready"}
                      aria-label={playing ? "暂停" : "播放"}
                      onClick={toggle}
                    >
                      {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
                    </button>
                    <button
                      disabled={!duration || status !== "ready"}
                      aria-label="前进十秒"
                      onClick={() => jump(time + 10)}
                    >
                      <Forward10 size={24} />
                    </button>
                    <button
                      disabled={selectedIndex < 0 || selectedIndex >= shown.length - 1}
                      aria-label="下一段"
                      onClick={() => adjacent(1)}
                    >
                      <SkipForward size={17} />
                    </button>
                  </div>
                  <div className="speed">
                    <PlaybackSpeed value={rate} onChange={setRate} />
                  </div>
                </div>
              </div>
            </div>
            <section className="correction">
              <div className="correction-title">
                <span className="slider-icon">
                  <SlidersHorizontal size={19} />
                </span>
                <div>
                  <h3>鱼眼画面校正</h3>
                  <p>四路独立校正 · 自然视角</p>
                </div>
                <CorrectionSwitch checked={correct} onChange={setCorrect} />
              </div>
              <label className={!correct ? "muted-control" : ""}>
                视野角度
                <PlayerSlider
                  label="视野角度"
                  min={60}
                  max={130}
                  value={fov}
                  onChange={setFov}
                  disabled={!correct}
                />
                <b>{fov}°</b>
              </label>
              <label className={!correct ? "muted-control" : ""}>
                校正强度
                <PlayerSlider
                  label="校正强度"
                  min={0}
                  max={1}
                  step={0.01}
                  value={strength}
                  onChange={setStrength}
                  disabled={!correct}
                />
                <b>{Math.round(strength * 100)}%</b>
              </label>
              <button
                className="reset"
                aria-label="重置校正参数"
                title="重置校正参数"
                onClick={() => {
                  setFov(95);
                  setStrength(1);
                }}
              >
                <RotateCcw size={16} />
              </button>
            </section>
            {error && status !== "error" && (
              <div className="notice" role="alert">
                <CircleHelp size={17} />
                {error}
                <button aria-label="重试播放" onClick={() => setRetry((n) => n + 1)}>
                  重试
                </button>
              </div>
            )}
          </div>
        </main>
      )}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
