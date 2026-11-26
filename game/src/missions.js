// missions.js — nine rescue sorties across the six strips. Every mission is a
// different job, not the same flight with a new name: climbers to lift off a
// ridge, medicine to drop on a valley floor, a storm front to punch through, a
// night medevac with fuel to spare or not. Each one names its strip, its rings,
// its weather and what a good landing is worth.

import { STRIPS, routePath } from './terrain.js';

// A ring gate: fly through it and the next one lights up.
export function ringAt(x, y, z, r) {
  return { x, y, z, r, passed: false };
}

export const MISSIONS = [
  {
    id: 0, legs: [1], stars: 1, name: 'First Light', strip: 1, kind: 'rescue',
    brief: 'Two climbers are stranded above Laguna Verde. Gentle wind, clear air — the training run. Land on the strip, pick them up, bring them home to Pampa Alta.',
    rings: 2, fuel: 100, wind: 8, storm: 0,
    pay: 400,
  },
  {
    id: 1, legs: [2], stars: 1, name: 'Valley Medicine', strip: 2, kind: 'supply',
    brief: 'Valle Verde clinic is out of medicine. Fly low through the valley, drop the crate over the strip marker, then land and confirm the delivery.',
    rings: 3, fuel: 100, wind: 12, storm: 0,
    pay: 550,
  },
  {
    id: 2, legs: [3], stars: 2, name: 'Ridge Pickup', strip: 3, kind: 'rescue',
    brief: 'A climber with a broken leg waits on the Cerro Viento ridge. The strip is short and the wind curls over the peak — come in slow, flaps down, and do not rush the flare.',
    rings: 3, fuel: 95, wind: 18, storm: 1,
    pay: 800,
  },
  {
    id: 3, legs: [4], stars: 3, name: 'Storm Front', strip: 4, kind: 'rescue',
    brief: 'A storm cell sits on the route to Cerro Torre. Punch through the front, ride the gusts, and land on the highest strip in the range before the cell closes over it.',
    rings: 4, fuel: 90, wind: 24, storm: 2,
    pay: 1100,
  },
  {
    id: 4, legs: [5], stars: 3, name: 'Night Medevac', strip: 5, kind: 'medevac',
    brief: 'Paso Nube, after dark, in rain. A shepherd needs a hospital, and you are the only aircraft that can reach the pass. Fuel is tight — fly clean, fly straight, no sightseeing.',
    rings: 3, fuel: 78, wind: 16, storm: 2,
    pay: 1400,
  },
  {
    id: 5, legs: [3,2], stars: 2, name: 'Double Lift', strip: 3, kind: 'rescue',
    brief: 'Two parties, one strip: pick up the Cerro Viento climbers, then cross to Valle Verde for a second pickup before the weather turns. Two landings, one tank.',
    rings: 4, fuel: 100, wind: 20, storm: 1,
    pay: 1250,
  },
  {
    id: 6, legs: [4], stars: 2, name: 'The Long Way Home', strip: 4, kind: 'supply',
    brief: 'Cerro Torre base camp needs fuel drums and food. Heavy load, long climb, a headwind all the way — manage the throttle or you will be gliding the last ten miles.',
    rings: 5, fuel: 100, wind: 22, storm: 1,
    pay: 1300,
  },
  {
    id: 7, legs: [5], stars: 3, name: 'Eye of the Storm', strip: 5, kind: 'rescue',
    brief: 'Three climbers on Paso Nube with a cell parked right over the pass. Thread the rings between the gusts, land in the rain, and get out before the lightning finds you.',
    rings: 5, fuel: 92, wind: 28, storm: 3,
    pay: 1800,
  },
  {
    id: 8, legs: [1,2,3], stars: 3, name: 'The Full Circuit', strip: 1, kind: 'rescue',
    brief: 'The whole range in one sortie: Laguna Verde, Valle Verde, Cerro Viento — three pickups, three landings, one tank, and a storm front rolling in behind you.',
    rings: 6, fuel: 100, wind: 20, storm: 2,
    pay: 2200,
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
}

export function targetStrip(mission) {
  return STRIPS.find((s) => s.id === mission.strip);
}

function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return total;
}

function pointAlong(pts, frac) {
  const total = pathLength(pts);
  let want = total * frac;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (want <= seg) {
      const t = seg === 0 ? 0 : want / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
      };
    }
    want -= seg;
  }
  return pts[pts.length - 1];
}

// The strip a leg of the mission flies to (multi-leg sorties chain several).
export function legStrip(mission, legIndex) {
  const id = mission.legs[Math.min(legIndex, mission.legs.length - 1)];
  return STRIPS.find((s) => s.id === id);
}

// Build the ring gates for one leg: a chain from one strip to the next.
// Bush pilots do not fly over the mountains — they follow the valleys, so the
// gates are spaced ~900 m along the valley path: close enough that the straight
// leg between two gates never cuts across a ridge.
export function buildRings(mission, terrain, from, to) {
  const rings = [];
  // The valley path runs to the final approach ring, not to the strip itself:
  // the final ring sits 1200 m out on the strip's heading, over the flattened
  // corridor, so the last gates descend onto it over flat ground and the
  // final leg to the runway is a straight, gentle descent.
  const hdg = (to.hdg * Math.PI) / 180;
  const finalPos = {
    x: to.x - Math.sin(hdg) * 1200,
    y: to.elev + 120,
    z: to.z + Math.cos(hdg) * 1200,
  };
  const path = routePath(from, finalPos, (x, z) => terrain.heightAt(x, z));
  // Dense gates (~500 m apart): short legs hug the valley path, so the
  // straight line between two gates never crosses a ridge.
  const n = Math.max(4, Math.min(12, Math.round(pathLength(path) / 500)));
  for (let i = 1; i <= n; i++) {
    const pt = pointAlong(path, i / (n + 1));
    const g = terrain.heightAt(pt.x, pt.z);
    rings.push(ringAt(pt.x, g + 260, pt.z, 70));
  }
  rings.push(ringAt(finalPos.x, finalPos.y, finalPos.z, 60));
  return rings;
}

// Score a finished sortie: pay for the job, bonuses for smooth flying.
export function scoreSortie(mission, stats) {
  let score = mission.pay;
  if (stats.smoothLanding) score += 250;
  if (stats.fuelLeft > 30) score += Math.round(stats.fuelLeft * 4);
  if (stats.ringsHit === stats.ringsTotal) score += 200;
  if (stats.timeSec < mission.parSec) score += 150;
  if (stats.damageTaken < 5) score += 150;
  return score;
}

export const HOME_STRIP = STRIPS[0];
