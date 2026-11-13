export function sameSnapshot(live, mirror) {
  if (!live?.index || !live?.civic || !mirror?.index || !mirror?.civic) return false;
  return live.index === mirror.index && live.civic === mirror.civic;
}

export const PUBLISH_TIMEOUT_MS = 90_000;

export async function cloudflareApiReachable(fetchImpl = fetch, timeoutMs = 8000) {
  try {
    const response = await fetchImpl("https://api.cloudflare.com/client/v4/accounts", { signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 500;
  } catch {
    return false;
  }
}

export function deployCommand(mirror, wranglerBin) {
  const runner = wranglerBin ? `node "${wranglerBin}"` : "npx --yes wrangler";
  return `${runner} pages deploy "${mirror}" --project-name hsinchu-watch --branch main --commit-dirty false --commit-message "Publish the hourly Hsinchu news index"`;
}
