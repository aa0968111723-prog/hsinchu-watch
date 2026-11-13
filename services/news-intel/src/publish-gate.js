export function sameSnapshot(live, mirror) {
  if (!live?.index || !live?.civic || !mirror?.index || !mirror?.civic) return false;
  return live.index === mirror.index && live.civic === mirror.civic;
}

export function deployCommand(mirror) {
  return `npx --yes wrangler pages deploy "${mirror}" --project-name hsinchu-watch --branch main --commit-dirty false --commit-message "Publish the hourly Hsinchu news index"`;
}
