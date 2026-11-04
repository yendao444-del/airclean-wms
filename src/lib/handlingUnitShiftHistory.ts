export type ShiftHistoryEntry = {
  key: string;
  at: string;
  time: string;
  shift: "midday" | "evening";
  code: string;
  result: string;
  remaining: number | null;
  actor: string;
  note: string;
};

const CHECK_TYPE = /^(kiểm cuối ca|kiểm khớp - chốt hết kiện|kiểm lệch - cập nhật tồn thực tế)/i;
// Same checkpoint as the shift policy: counts up to 12:30 belong to the midday shift.
const MIDDAY_DEADLINE_MINUTES = 12 * 60 + 30;

const bangkokParts = (value: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
};

const resultLabel = (type: string) => {
  if (/^kiểm khớp - chốt hết kiện/i.test(type)) return "Chốt hết kiện";
  if (/^kiểm lệch/i.test(type)) return "Điều chỉnh tồn";
  if (/điều chỉnh/i.test(type)) return "Điều chỉnh";
  return "Khớp";
};

// Completed counts recorded on the given Bangkok day, newest first.
export function shiftChecksOnDay(entries: readonly any[], day: string): ShiftHistoryEntry[] {
  const rows: ShiftHistoryEntry[] = [];
  entries.forEach((entry, index) => {
    const type = String(entry?.type || "");
    if (!CHECK_TYPE.test(type)) return;
    const at = new Date(entry?.createdAt);
    if (Number.isNaN(at.getTime())) return;
    const parts = bangkokParts(at);
    if (parts.day !== day) return;
    const remaining = Number(entry?.remaining);
    rows.push({
      key: `${entry?.id || entry?.unitId || "check"}-${at.getTime()}-${index}`,
      at: at.toISOString(),
      time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
      shift: parts.hour * 60 + parts.minute <= MIDDAY_DEADLINE_MINUTES ? "midday" : "evening",
      code: String(entry?.unitId || "").trim().toUpperCase(),
      result: resultLabel(type),
      remaining: Number.isFinite(remaining) ? remaining : null,
      actor: String(entry?.actor || ""),
      note: String(entry?.note || ""),
    });
  });
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
