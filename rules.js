// Прыгуха: physics constants and the level generator. The same seed always builds the same level,
// so a finished run can be checked against its level: the coins and the height it reports.
// World units: the field is WORLD_W wide, y grows upward from 0, a platform's y is its top surface.

export const WORLD_W = 360;
export const GRAVITY = 1800;          // units/s²
export const JUMP_V = 860;            // bounce off a platform
export const SPRING_V = 1500;         // bounce off a spring
export const STOMP_V = 980;           // bounce off a stomped ink blot
export const MAX_FALL = 1400;
export const MOVE_V = 330;            // full sideways speed
export const PLAT_W = 68, PLAT_H = 16;
export const COIN_R = 13;
export const MOB_W = 46, MOB_H = 40;
export const SCORE_DIV = 10;          // score = height / SCORE_DIV
export const JUMP_H = (JUMP_V * JUMP_V) / (2 * GRAVITY); // ≈205, the highest a plain bounce reaches
// The fastest climb a run may show, units/s: plain bounces give ~430 at best, springs come once per 900
export const MAX_CLIMB = 800;

const SAFE_GAP = JUMP_H * 0.86;       // the biggest gap between two platforms you can stand on
const HARD_AT = 40000;                // height where the difficulty stops growing

// Seeded random 0..1 (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, k) => a + (b - a) * k;

// Placement: every thing takes a box as drawn (a moving one — its whole sweep). A new thing tries a few x
// until its box keeps CLEAR above and below and SIDE to the left and right of every box near it.
const CLEAR = 26, SIDE = 8, TRIES = 12;
const MIN_GAP = 56;                   // the closest two platforms you can stand on get, one above the other
const SPRING_EVERY = 900;             // at least this much height between two springs

const platBox = (x, y, range = 0, spring = false) =>
  ({ x1: x - range - 4, x2: x + range + PLAT_W + 4, y1: y - PLAT_H - 8, y2: y + 4 + (spring ? 26 : 0) });
const coinBox = (x, y) => ({ x1: x - COIN_R, x2: x + COIN_R, y1: y - COIN_R, y2: y + COIN_R });
const mobBox = (x0, y, range) => ({ x1: x0 - range - 4, x2: x0 + range + MOB_W + 4, y1: y - 4, y2: y + MOB_H + 4 });

// The level grows on demand: extend(y) adds platforms, coins and ink blots up to height y.
// Platforms: { id, x, y, t } with t "n" (plain), "m" (moving: x0, range, speed, phase), "b" (breaks, no bounce);
// a plain one may carry spring: true. Coins: { id, x, y }. Ink blots: { id, x0, y, range, speed, phase }.
export function makeLevel(seed) {
  const r = rng(seed);
  const plats = [], coins = [], mobs = [];
  let top = 0, pid = 0, cid = 0, mid = 0, lastMob = 0, lastSpring = 0;
  let boxes = [];

  // skip: a box the new one may touch (a coin and its own platform)
  const free = (b, skip = null) => boxes.every(o => o === skip ||
    b.x2 + SIDE <= o.x1 || o.x2 + SIDE <= b.x1 || b.y2 + CLEAR <= o.y1 || o.y2 + CLEAR <= b.y1);
  // make() draws a candidate { box, ... }; the first that fits takes its place, null if none did
  function place(make) {
    for (let i = 0; i < TRIES; i++) {
      const c = make();
      if (free(c.box)) { boxes.push(c.box); return c; }
    }
    return null;
  }

  // Start: a plain platform right under the frog
  plats.push({ id: pid++, x: WORLD_W / 2 - PLAT_W / 2, y: 40, t: "n" });
  boxes.push(platBox(WORLD_W / 2 - PLAT_W / 2, 40));
  top = 40;

  function step() {
    const d = Math.min(1, top / HARD_AT);
    const gap = Math.min(SAFE_GAP, lerp(MIN_GAP, 150, d) + r() * lerp(24, 30, d));
    const y = top + gap;
    boxes = boxes.filter(b => b.y2 > top - 240);

    // A platform you can stand on: moving, plain with a spring, or plain. It always gets a place:
    // if a moving one does not fit, a plain one tries; if nothing fits, a plain one goes anyway.
    const moving = top > 1500 && r() < lerp(0.08, 0.4, d);
    const spring = !moving && top > 300 && y - lastSpring >= SPRING_EVERY && r() < 0.1;
    let p = null;
    if (moving) {
      const range = lerp(40, 130, r()), speed = lerp(0.8, 1.6 + d, r()), phase = r() * Math.PI * 2;
      p = place(() => {
        const x = lerp(range, WORLD_W - PLAT_W - range, r());
        return { box: platBox(x, y, range), x, range, speed, phase, t: "m" };
      });
    }
    if (!p) {
      p = place(() => {
        const x = r() * (WORLD_W - PLAT_W);
        return { box: platBox(x, y, 0, spring), x, t: "n", spring };
      });
    }
    if (!p) {
      const x = r() * (WORLD_W - PLAT_W);
      p = { box: platBox(x, y), x, t: "n" };
      boxes.push(p.box);
    }
    const plat = { id: pid++, x: p.x, y, t: p.t };
    if (p.t === "m") Object.assign(plat, { range: p.range, speed: p.speed, phase: p.phase });
    if (p.spring) { plat.spring = true; lastSpring = y; }
    plats.push(plat);

    // A coin above a plain platform, more of them higher up; skipped if something is in the way
    if (plat.t === "n" && !plat.spring && r() < lerp(0.35, 0.55, d)) {
      const c = { x: plat.x + PLAT_W / 2, y: y + 34 };
      c.box = coinBox(c.x, c.y);
      if (free(c.box, p.box)) {
        boxes.push(c.box);
        coins.push({ id: cid++, x: c.x, y: c.y, plat: plat.id });
      }
    }

    // A fragile eraser in between, where there is room: it only looks like a step
    if (top > 600 && r() < lerp(0.12, 0.35, d)) {
      const fy = top + gap * lerp(0.35, 0.65, r());
      const f = place(() => {
        const x = r() * (WORLD_W - PLAT_W);
        return { box: platBox(x, fy), x };
      });
      if (f) plats.push({ id: pid++, x: f.x, y: fy, t: "b" });
    }

    // An ink blot now and then, never two close to each other; if there is no room, the next gap tries again
    if (y > 2500 && y - lastMob > 900 && r() < lerp(0.05, 0.12, d)) {
      const range = lerp(20, 70, r()), speed = lerp(0.6, 1.4, r()), phase = r() * Math.PI * 2;
      const my = top + gap * 0.5 - MOB_H / 2;
      const m = place(() => {
        const x0 = lerp(range, WORLD_W - MOB_W - range, r());
        return { box: mobBox(x0, my, range), x0 };
      });
      if (m) {
        mobs.push({ id: mid++, x0: m.x0, y: my, range, speed, phase });
        lastMob = y;
      }
    }

    top = y;
  }

  return {
    plats, coins, mobs,
    get top() { return top; },
    extend(y) { while (top < y) step(); },
  };
}

// x of a moving platform or an ink blot at run time t (seconds)
export const platX = (p, t) => (p.t === "m" ? p.x + Math.sin(p.phase + t * p.speed) * p.range : p.x);
export const mobX = (m, t) => m.x0 + Math.sin(m.phase + t * m.speed) * m.range;

// Is a reported run possible on this seed? height is the highest the frog's feet got,
// coinIds the coins picked up, ms how long the run took. Returns null if fine, otherwise what is wrong.
export function checkRun(seed, height, coinIds, ms) {
  if (!Number.isFinite(height) || height < 0) return "height";
  if (!Number.isFinite(ms) || ms <= 0) return "time";
  if (height > (ms / 1000) * MAX_CLIMB + JUMP_H * 2) return "too fast";
  if (!Array.isArray(coinIds) || new Set(coinIds).size !== coinIds.length) return "coins";

  const lvl = makeLevel(seed);
  lvl.extend(height + JUMP_H * 2);
  const reach = height + JUMP_H + 80;
  const ok = new Set(lvl.coins.filter(c => c.y <= reach).map(c => c.id));
  return coinIds.every(id => ok.has(id)) ? null : "coins";
}

export const scoreOf = height => Math.floor(height / SCORE_DIV);
