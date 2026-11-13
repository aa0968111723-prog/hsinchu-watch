export const ALLOWED_HOSTS = new Set([
  "www.hsinchu.gov.tw",
  "www.hcc.gov.tw",
  "www.hccg.gov.tw",
  "www.cna.com.tw",
  "data.gov.tw",
  "ws.hsinchu.gov.tw",
  "web.pcc.gov.tw",
]);

export function allowedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "169.254.169.254") return false;
    return ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}
