export function taipeiStamp(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return text;
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(parsed));
  return `${formatted} 臺北時間`;
}
