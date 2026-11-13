/**
 * Pure motion helpers. No DOM, so a figure's model can use them in the page
 * and in a Node test alike.
 */
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Eases toward a target. `calm` (reduced motion) jumps straight there. */
export function follow(current, target, dt, seconds, calm) {
  if (calm) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / seconds));
  return Math.abs(target - next) < 0.02 ? target : next;
}

/** Sub-stepped spring on { at, rate }. Returns true once it rests on the target. */
export function spring(state, target, dt, stiffness, damping, calm) {
  if (calm) {
    state.at = target;
    state.rate = 0;
    return true;
  }
  const steps = 4;
  for (let step = 0; step < steps; step++) {
    state.rate += ((target - state.at) * stiffness - state.rate * damping) * (dt / steps);
    state.at += state.rate * (dt / steps);
  }
  if (Math.abs(target - state.at) < 0.01 && Math.abs(state.rate) < 0.01) {
    state.at = target;
    state.rate = 0;
    return true;
  }
  return false;
}
