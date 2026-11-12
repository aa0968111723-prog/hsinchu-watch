/** Evidence classes for the stamp bench. Thickness is the folder in this model, not a policy score. */
export const FOLDERS = [
  { id: "unknown", label: "尚未核對", thickness: 8 },
  { id: "agency_report", label: "機關報告", thickness: 14 },
  { id: "independently_checked", label: "獨立查核", thickness: 20 },
];

export const STAMP_X = 22;
export const STAMP_Y = 0;
export const FW = 24;
export const FD = 40;
export const STEP = 36;
export const F0 = 0;
export const FY = -20;
export const CARRIAGE_TOP = 9;

export const localCenter = (index) => F0 + index * STEP + FW / 2;
export const stopFor = (index) => STAMP_X - localCenter(index);
export const STOPS = FOLDERS.map((_, index) => stopFor(index));
export const REACH = [STOPS[STOPS.length - 1] - 10, STOPS[0] + 10];

export function folderUnder(tx) {
  const x = STAMP_X - tx;
  return FOLDERS.findIndex((_, index) => {
    const left = F0 + index * STEP;
    return x >= left && x <= left + FW;
  });
}

export function contactHeight(tx) {
  const index = folderUnder(tx);
  if (index < 0) return CARRIAGE_TOP;
  return CARRIAGE_TOP + FOLDERS[index].thickness;
}

export function readout(tx, height) {
  const index = folderUnder(tx);
  if (index < 0) return "夾與夾之間 · 壓在台面";
  return `${FOLDERS[index].label} · 夾厚 ${FOLDERS[index].thickness}`;
}

export function nearestStop(tx) {
  return STOPS.reduce((best, stop, index) => (Math.abs(stop - tx) < Math.abs(STOPS[best] - tx) ? index : best), 0);
}
