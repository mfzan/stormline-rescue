// terrain.js — the world of STORMLINE: a seeded Andean heightfield, six mountain
// airstrips, two lakes and the peaks the pilot must respect. Everything here is
// deterministic: the same seed always builds the same mountains, so a screenshot
// taken today renders exactly the same ridge tomorrow.

export const WORLD_SIZE = 12000; // metres, square world, origin at the centre
export const GRID = 64; // heightfield cells per side (64 keeps the frame rate up)
export const CELL = WORLD_SIZE / GRID;

// Mulberry32 — small deterministic PRNG, seeded per world.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise over a grid of control points, for rolling hills.
function makeNoise(rng, points, scale) {
  const g = [];
  for (let i = 0; i <= points; i++) {
    g.push([]);
    for (let j = 0; j <= points; j++) g[i].push(rng());
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, z) {
    const fx = (x / WORLD_SIZE + 0.5) * points;
    const fz = (z / WORLD_SIZE + 0.5) * points;
    const ix = Math.min(points - 1, Math.floor(fx));
    const iz = Math.min(points - 1, Math.floor(fz));
    const tx = smooth(fx - ix), tz = smooth(fz - iz);
    const a = g[ix][iz], b = g[ix + 1][iz], c = g[ix][iz + 1], d = g[ix + 1][iz + 1];
    return (a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz) * scale;
  };
}

// Peaks stand clear of the north-south valley corridor (|x| < 1500), so the
// route out of Pampa Alta runs down a real valley instead of into a wall.
export const PEAKS = [
  { name: 'Cerro Viento', x: -3400, z: -2900, h: 2295, r: 1500 },
  { name: 'Cerro Torre', x: 2900, z: -3300, h: 2420, r: 1400 },
  { name: 'Cerro Blanco', x: -2600, z: 4200, h: 2057, r: 1600 },
  { name: 'Cerro Rojo', x: 3800, z: 2400, h: 1938, r: 1300 },
  { name: 'Cerro Nube', x: 1800, z: -1500, h: 1709, r: 1700 },
];

export const LAKES = [
  { name: 'Laguna Verde', x: -1800, z: 1050, r: 650, level: 210 },
  { name: 'Laguna Azul', x: 2100, z: 1100, r: 800, level: 235 },
];

// Six strips: name, position, heading (deg), length, elevation, difficulty.
export const STRIPS = [
  { id: 0, name: 'Pampa Alta', x: 0, z: 5200, hdg: 0, len: 900, elev: 320, diff: 1 },
  { id: 1, name: 'Laguna Verde', x: -1800, z: 300, hdg: 90, len: 700, elev: 260, diff: 1 },
  { id: 2, name: 'Valle Verde', x: -2600, z: -1400, hdg: 45, len: 620, elev: 420, diff: 2 },
  { id: 3, name: 'Cerro Viento', x: -3400, z: -1900, hdg: 200, len: 520, elev: 760, diff: 3 },
  { id: 4, name: 'Cerro Torre', x: 2900, z: -2400, hdg: 300, len: 480, elev: 880, diff: 3 },
  { id: 5, name: 'Paso Nube', x: 600, z: -300, hdg: 135, len: 420, elev: 980, diff: 3 },
];

// Walk a valley path from one strip to another: step ~350 m toward the target,
// each step picking the lowest ground within 250 m to either side, so the path
// snakes along valley floors instead of climbing over ridges.
export function routePath(from, to, heightAt) {
  const pts = [{ x: from.x, z: from.z, g: heightAt(from.x, from.z) }];
  let cx = from.x, cz = from.z;
  let guard = 0;
  while (Math.hypot(to.x - cx, to.z - cz) > 400 && guard++ < 60) {
    const dx = to.x - cx, dz = to.z - cz;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const px = -uz, pz = ux;
    let best = null;
    for (const off of [-250, 0, 250]) {
      const x = cx + ux * 350 + px * off;
      const z = cz + uz * 350 + pz * off;
      const g = heightAt(x, z);
      if (!best || g < best.g) best = { x, z, g };
    }
    cx = best.x; cz = best.z;
    pts.push({ x: cx, z: cz, g: best.g });
  }
  pts.push({ x: to.x, z: to.z, g: heightAt(to.x, to.z) });
  return pts;
}

export function buildTerrain(seed) {
  const rng = makeRng(seed);
  const hills = makeNoise(rng, 6, 500);
  const detail = makeNoise(rng, 28, 180);
  const heights = new Float32Array((GRID + 1) * (GRID + 1));
  const at = (i, j) => heights[j * (GRID + 1) + i];

  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = (i / GRID - 0.5) * WORLD_SIZE;
      const z = (j / GRID - 0.5) * WORLD_SIZE;
      let h = 240 + hills(x, z) + detail(x, z);
      for (const p of PEAKS) {
        const dx = x - p.x, dz = z - p.z;
        const d2 = (dx * dx + dz * dz) / (p.r * p.r);
        h += p.h * Math.exp(-d2 * 2.2);
      }
      for (const l of LAKES) {
        const dx = x - l.x, dz = z - l.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < l.r) h = Math.min(h, l.level - 6 + (d / l.r) * 8);
      }
      // The central valley: a low corridor down the middle of the map, so the
      // route out of Pampa Alta runs through a valley instead of into a wall.
      // Full depth inside |x| < 600, fading out by |x| = 1500.
      const ax = Math.abs(x);
      const k = ax < 600 ? 1 : ax > 1500 ? 0 : 1 - (ax - 600) / 900;
      h = h * (1 - k) + 380 * k;
      heights[j * (GRID + 1) + i] = h;
    }
  }

  // Flatten the ground under each strip so the runway sits level — and carve
  // a flat approach/departure corridor 700 m past each threshold, so a plane
  // can actually lift off and land instead of meeting a mountainside the
  // moment it leaves the runway (the home strip used to sit at the foot of
  // a slope steeper than the climb rate: nothing ever got airborne).
  for (const s of STRIPS) {
    const dirX = Math.sin((s.hdg * Math.PI) / 180);
    const dirZ = -Math.cos((s.hdg * Math.PI) / 180);
    const perpX = dirZ, perpZ = -dirX;
    const half = s.len / 2 + 1400, wide = 520;
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const x = (i / GRID - 0.5) * WORLD_SIZE;
        const z = (j / GRID - 0.5) * WORLD_SIZE;
        const along = (x - s.x) * dirX + (z - s.z) * dirZ;
        const across = (x - s.x) * perpX + (z - s.z) * perpZ;
        if (Math.abs(along) < half && Math.abs(across) < wide) {
          const edge = Math.max(Math.abs(along) / half, Math.abs(across) / wide);
          const blend = edge < 0.7 ? 0 : (edge - 0.7) / 0.3;
          const idx = j * (GRID + 1) + i;
          heights[idx] = heights[idx] * blend + s.elev * (1 - blend);
        }
      }
    }
  }

  // Carve a flyable channel along every sortie route: the terrain within
  // 700 m of a route's valley path is capped at the path's own ground + 20 m,
  // so the valley the gates mark is a real valley — no ridge can rise up
  // between two gates and swallow a plane flying the marked route.
  const rawAt = (x, z) => {
    const fx = (x / WORLD_SIZE + 0.5) * GRID;
    const fz = (z / WORLD_SIZE + 0.5) * GRID;
    const i = Math.max(0, Math.min(GRID - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(GRID - 1, Math.floor(fz)));
    const tx = fx - i, tz = fz - j;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  const routes = [];
  for (const s of STRIPS) {
    if (s.id === 0) continue;
    const hdg = (s.hdg * Math.PI) / 180;
    routes.push(routePath(STRIPS[0], {
      x: s.x - Math.sin(hdg) * 1200,
      z: s.z + Math.cos(hdg) * 1200,
    }, rawAt));
  }
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = (i / GRID - 0.5) * WORLD_SIZE;
      const z = (j / GRID - 0.5) * WORLD_SIZE;
      let cap = Infinity;
      for (const route of routes) {
        for (const pt of route) {
          const d = Math.hypot(x - pt.x, z - pt.z);
          if (d < 700) cap = Math.min(cap, pt.g + 20);
        }
      }
      if (cap !== Infinity) {
        const idx = j * (GRID + 1) + i;
        heights[idx] = Math.min(heights[idx], cap);
      }
    }
  }

  // Precompute a colour per cell so the renderer never recomputes shading.
  const colors = new Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const h = (at(i, j) + at(i + 1, j) + at(i, j + 1) + at(i + 1, j + 1)) / 4;
      const slope = Math.abs(at(i + 1, j) - at(i, j)) + Math.abs(at(i, j + 1) - at(i, j));
      colors[j * GRID + i] = shadeFor(h, slope, xOf(i), zOf(j));
    }
  }
  function xOf(i) { return (i / GRID - 0.5) * WORLD_SIZE; }
  function zOf(j) { return (j / GRID - 0.5) * WORLD_SIZE; }

  return {
    heights, colors,
    heightAt(x, z) {
      const fx = (x / WORLD_SIZE + 0.5) * GRID;
      const fz = (z / WORLD_SIZE + 0.5) * GRID;
      const i = Math.max(0, Math.min(GRID - 1, Math.floor(fx)));
      const j = Math.max(0, Math.min(GRID - 1, Math.floor(fz)));
      const tx = fx - i, tz = fz - j;
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    },
  };
}

// One style for the whole world: dusk-lit valleys, rock, snow above the tree line.
function shadeFor(h, slope, x, z) {
  const rng = makeRng((Math.floor(x) * 31 + Math.floor(z) * 57) >>> 0);
  const jitter = (rng() - 0.5) * 10;
  let r, g, b;
  if (h < 250) { r = 96; g = 122; b = 74; } // valley grass
  else if (h < 700) { r = 110; g = 118; b = 70; } // dry grass
  else if (h < 1200) { r = 122; g = 104; b = 78; } // scree
  else if (h < 1450) { r = 104; g = 98; b = 92; } // rock
  else { r = 232; g = 236; b = 242; } // snow
  const steep = Math.min(1, slope / 260);
  r = r * (1 - steep * 0.35) + 52 * steep * 0.35;
  g = g * (1 - steep * 0.35) + 48 * steep * 0.35;
  b = b * (1 - steep * 0.35) + 46 * steep * 0.35;
  // Lakes read as flat water.
  for (const l of LAKES) {
    const dx = x - l.x, dz = z - l.z;
    if (dx * dx + dz * dz < l.r * l.r * 0.9) { r = 62; g = 108; b = 138; }
  }
  const sun = 1.06; // low dusk sun from the west warms everything slightly
  return `rgb(${Math.min(255, (r + jitter) * sun | 0)},${Math.min(255, (g + jitter) * 0.98 | 0)},${Math.min(255, (b + jitter) * 0.94 | 0)})`;
}

export function stripById(id) {
  return STRIPS.find((s) => s.id === id);
}
