import { Empty, Tag } from "antd";
import type { ShiftHistoryEntry } from "../lib/handlingUnitShiftHistory";

const SHIFT_SECTIONS = [
  { key: "evening", label: "Ca chiều" },
  { key: "midday", label: "Ca trưa (đến 12:30)" },
] as const;
const RESULT_COLOR: Record<string, string> = { "Khớp": "green", "Chốt hết kiện": "blue" };

// Read-only list of today's completed end-of-shift counts.
export default function HandlingUnitShiftHistory({ entries, describe }: {
  entries: readonly ShiftHistoryEntry[];
  describe: (code: string) => { name: string; unitName: string };
}) {
  if (!entries.length) return <Empty className="hu-shift-history-empty" description="Hôm nay chưa có lần kiểm cuối ca nào." />;
  return <div className="hu-shift-history">
    {SHIFT_SECTIONS.map((section) => {
      const rows = entries.filter((entry) => entry.shift === section.key);
      if (!rows.length) return null;
      return <section key={section.key} className="hu-shift-history-section">
        <h4>{section.label} · {rows.length} lần kiểm</h4>
        <div className="hu-shift-history-table" role="table">
          <div className="hu-shift-history-row is-head" role="row">
            {["Giờ", "Kiện", "Kết quả", "Số đếm", "Người kiểm"].map((label) => <span key={label} role="columnheader">{label}</span>)}
          </div>
          {rows.map((row) => {
            const info = describe(row.code);
            return <div key={row.key} className="hu-shift-history-row" role="row" title={row.note || undefined}>
              <span role="cell">{row.time}</span>
              <span role="cell" className="hu-shift-history-unit"><b>{row.code}</b><small>{info.name}</small></span>
              <span role="cell"><Tag color={RESULT_COLOR[row.result] || "orange"}>{row.result}</Tag></span>
              <span role="cell">{row.remaining === null ? "—" : `${row.remaining.toLocaleString("vi-VN")} ${info.unitName}`}</span>
              <span role="cell">{row.actor || "—"}</span>
            </div>;
          })}
        </div>
      </section>;
    })}
  </div>;
}
