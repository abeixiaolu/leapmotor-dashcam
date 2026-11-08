import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { useState } from "react";
import {
  CalendarIcon,
  ChevronRight,
  CircleHelp,
  HardDrive,
  RefreshCw,
  Search,
  ShieldCheck,
  Usb,
  Video,
} from "../icons";
import { RecordingCalendar } from "../RecordingCalendar";
import type { Drive, Recording } from "../App";
import SpotlightCard from "./SpotlightCard";

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
  onDate: (date: string) => void;
  onChoose: (id: string) => void;
  onScan: () => void;
  onHelp: () => void;
};

export function RecordingList(p: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  return (
    <main className="list-page">
      <header className="list-header">
        <div className="list-brand">
          <Video size={23} /> 零跑记录仪
        </div>
        <button onClick={p.onHelp}>
          <CircleHelp size={18} />
          使用指南
        </button>
      </header>
      <div className="list-content">
        <div className="list-title">
          <div>
            <h1>录像资料库</h1>
            <p>选择一段录像，回看旅途中的每个视角。</p>
          </div>
          <button className="primary" disabled={p.scanning} onClick={p.onScan}>
            <RefreshCw size={16} className={p.scanning ? "spinning" : ""} />
            {p.scanning ? "正在扫描" : "重新扫描"}
          </button>
        </div>
        <SpotlightCard
          className="source-card"
          theme="light"
          spotlightColor="#57b592"
          intensity={0.12}
        >
          <div className="drive-icon">
            <Usb size={25} />
          </div>
          <div className="source-copy">
            <b>{p.drive ? `${p.drive.name} · 零跑行车记录仪` : "正在等待你的行车记录仪 U 盘"}</b>
            <p>
              {p.drive
                ? `已识别 ${p.records.length} 段录像`
                : "插入电脑后自动扫描，无需选择文件夹。"}
            </p>
          </div>
          <div className="source-assurance">
            <ShieldCheck size={17} /> U 盘全程只读
          </div>
        </SpotlightCard>
        {p.scanError && (
          <div className="notice" role="status">
            {p.scanError}
          </div>
        )}
        <section className="list-panel">
          <div className="list-panel-heading">
            <div>
              <h2>所有录像</h2>
              <p>{p.shown.length} 段录像</p>
            </div>
            {p.drives.length > 1 && (
              <label className="list-drive">
                <HardDrive size={16} />
                <select
                  aria-label="选择U盘"
                  value={p.drive?.id}
                  onChange={(e) => p.setDriveId(e.target.value)}
                >
                  {p.drives.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="list-filters">
            <div className="kind-tabs">
              <button
                className={p.kind === "drive" ? "selected" : ""}
                onClick={() => p.setKind("drive")}
              >
                行车 <small>{p.records.filter((r) => r.kind === "drive").length}</small>
              </button>
              <button
                className={p.kind === "sentinel" ? "selected" : ""}
                onClick={() => p.setKind("sentinel")}
              >
                哨兵 <small>{p.records.filter((r) => r.kind === "sentinel").length}</small>
              </button>
            </div>
            <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
              <DialogTrigger asChild>
                <button className="date-filter">
                  <CalendarIcon size={18} />
                  {p.date || "选择录像日期"}
                  <ChevronRight size={16} />
                </button>
              </DialogTrigger>
              <DialogContent className="date-dialog">
                <DialogTitle>选择录像日期</DialogTitle>
                <DialogDescription>选择有录像的日期进行筛选。</DialogDescription>
                <RecordingCalendar
                  date={p.date}
                  counts={p.counts}
                  onSelect={(date) => {
                    p.onDate(date);
                    setCalendarOpen(false);
                  }}
                />
              </DialogContent>
            </Dialog>
            <div className="search">
              <Search size={15} />
              <input
                placeholder="搜索日期、时间"
                aria-label="搜索录像"
                value={p.query}
                onChange={(e) => p.setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="list-recordings">
            {p.shown.length ? (
              p.shown.map((r) => (
                <button className="list-clip" key={r.id} onClick={() => p.onChoose(r.id)}>
                  <span className="clip-icon">
                    <Video size={20} />
                  </span>
                  <span>
                    <b>{r.stamp.split(" ")[1] || r.stamp}</b>
                    <small>{r.stamp.split(" ")[0]} · 四路全景</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))
            ) : (
              <div className="library-empty">
                <div className="empty-mini">
                  <Usb size={25} />
                </div>
                <b>
                  {p.scanning ? "正在寻找录像" : p.drive ? "没有匹配的录像" : "插上 U 盘，就能回看"}
                </b>
                <p>
                  {p.drive ? "试试其他时间或录像分类" : "自动识别零跑录像目录，无需手动选择文件。"}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
