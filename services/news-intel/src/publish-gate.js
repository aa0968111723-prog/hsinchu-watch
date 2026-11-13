export function sameSnapshot(live, mirror) {
  if (!live?.index || !live?.civic || !mirror?.index || !mirror?.civic) return false;
  return live.index === mirror.index && live.civic === mirror.civic;
}

export const PUBLISH_TIMEOUT_MS = 90_000;

export function cloudflareAuthHeaders(configText = "", now = Date.now()) {
  const token = String(configText).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  const expiry = String(configText).match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
  if (!token || (expiry && Date.parse(expiry) <= now)) return {};
  return { authorization: `Bearer ${token}` };
}

export async function cloudflareApiReachable(fetchImpl = fetch, timeoutMs = 8000, headers = {}) {
  try {
    const response = await fetchImpl("https://api.cloudflare.com/client/v4/accounts/380f907638bc2293fa09da0666ac15fd/pages/projects/hsinchu-watch", { signal: AbortSignal.timeout(timeoutMs), headers });
    return { ok: response.status === 200, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function deployCommand(mirror, wranglerBin) {
  const runner = wranglerBin ? `node "${wranglerBin}"` : "npx --yes wrangler";
  return `${runner} pages deploy "${mirror}" --project-name hsinchu-watch --branch main --commit-dirty false --commit-message "Publish the hourly Hsinchu news index"`;
}
