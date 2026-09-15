function getBangkokDateParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function calculateMarketplaceSlaDeadline(orderPlacedAt) {
  const placedAt = orderPlacedAt instanceof Date ? orderPlacedAt : new Date(orderPlacedAt);
  if (Number.isNaN(placedAt.getTime())) return null;
  const parts = getBangkokDateParts(placedAt);
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  const hour = Number(parts.hour);

  // SLA hiện hành: trước 14:00 xử lý trong ngày; từ 14:00 chuyển sang
  // ngày làm việc kế tiếp. Hệ thống vận hành thứ Hai đến thứ Bảy.
  const localNoonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  if (localNoonUtc.getUTCDay() === 0 || hour >= 14) {
    do {
      localNoonUtc.setUTCDate(localNoonUtc.getUTCDate() + 1);
    } while (localNoonUtc.getUTCDay() === 0);
    year = localNoonUtc.getUTCFullYear();
    month = localNoonUtc.getUTCMonth() + 1;
    day = localNoonUtc.getUTCDate();
  }

  // Bangkok là UTC+7 quanh năm; 23:59:59.999 địa phương = 16:59:59.999Z.
  return new Date(Date.UTC(year, month - 1, day, 16, 59, 59, 999));
}

module.exports = { calculateMarketplaceSlaDeadline, getBangkokDateParts };
