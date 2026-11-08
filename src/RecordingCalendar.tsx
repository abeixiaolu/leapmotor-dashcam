import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "./icons";
import { calendarCells, shiftMonth } from "./calendar";
export function RecordingCalendar({
  date,
  counts,
  onSelect,
}: {
  date: string;
  counts: Map<string, number>;
  onSelect: (date: string) => void;
}) {
  const dates = [...counts.keys()].sort();
  const fallback =
    dates.at(-1)?.slice(0, 7) ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(date.slice(0, 7) || fallback);
  useEffect(() => {
    setMonth(date.slice(0, 7) || fallback);
  }, [date, fallback]);
  const first = dates[0]?.slice(0, 7),
    last = dates.at(-1)?.slice(0, 7);
  return (
    <section className="recording-calendar" aria-label="录像日历">
      <div className="calendar-heading">
        <button
          aria-label="上个月"
          disabled={!first || month <= first}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <strong aria-live="polite">
          {month.slice(0, 4)}年{Number(month.slice(5))}月
        </strong>
        <button
          aria-label="下个月"
          disabled={!last || month >= last}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="calendar-week" aria-hidden="true">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div key={month} className="calendar-days motion-enter">
        {calendarCells(month).map((day, i) =>
          day ? (
            <button
              key={day}
              disabled={!counts.has(day)}
              aria-label={`${day}，${counts.get(day) || 0}段录像`}
              aria-pressed={day === date}
              className={day === date ? "selected" : ""}
              onClick={() => onSelect(day)}
            >
              <span>{Number(day.slice(8))}</span>
              {counts.has(day) && <i />}
            </button>
          ) : (
            <span key={`blank-${i}`} aria-hidden="true" />
          ),
        )}
      </div>
      <p>
        <i className="green-dot" />
        有录像的日期可选<span>{date ? `${counts.get(date) || 0} 段录像` : "暂无录像"}</span>
      </p>
    </section>
  );
}
