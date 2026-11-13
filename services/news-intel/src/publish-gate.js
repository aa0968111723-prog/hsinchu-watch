export function sameSnapshot(live, mirror) {
  if (!live?.index || !live?.civic || !mirror?.index || !mirror?.civic) return false;
  return live.index === mirror.index && live.civic === mirror.civic;
}
