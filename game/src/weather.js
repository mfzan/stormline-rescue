// weather.js — live storm fronts over the Andes. Three cells drift across the
// map, each a disc of rain, gusting crosswind and turbulence with a lightning
// clock. Flying through one is a decision, not a decoration: gusts shove the
// plane sideways, rain cuts visibility, and a strike nearby rattles the airframe.

export function createWeather(seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const cells = [];
  const spots = [
    { x: -2200, z: -1800, r: 1500 },
    { x: 1500, z: -2600, r: 1300 },
    { x: 2400, z: 1800, r: 1600 },
  ];
  for (const sp of spots) {
    cells.push({
      x: sp.x, y: 0, z: sp.z, r: sp.r,
      vx: (rnd() - 0.5) * 6, vz: (rnd() - 0.5) * 6,
      strength: 0.7 + rnd() * 0.3,
      flash: 0, flashTimer: 4 + rnd() * 9, // seconds to the next strike
      rainSeed: rnd() * 1000,
    });
  }
  return {
    cells,
    baseWind: { deg: 270, kt: 12 }, // prevailing westerly
    time: 0,
    // Advance the fronts; dt in seconds.
    step(dt) {
      this.time += dt;
      for (const c of this.cells) {
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        if (c.x < -5200 || c.x > 5200) c.vx *= -1;
        if (c.z < -5200 || c.z > 5200) c.vz *= -1;
        c.flashTimer -= dt;
        if (c.flashTimer <= 0) {
          c.flash = 1;
          c.flashTimer = 5 + Math.random() * 11;
        }
        c.flash = Math.max(0, c.flash - dt * 2.4);
      }
    },
    // Wind at a point: base wind plus the gust field of any cell overhead.
    // Returns {x, z} in m/s over the ground plus a turbulence gust 0..1.
    windAt(x, z, y) {
      const base = (this.baseWind.kt * 0.514444);
      const brad = (this.baseWind.deg * Math.PI) / 180;
      let wx = Math.sin(brad) * base;
      let wz = -Math.cos(brad) * base;
      let gust = 0;
      let inside = 0;
      for (const c of this.cells) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < c.r) {
          const k = (1 - d / c.r) * c.strength;
          inside = Math.max(inside, k);
          const t = this.time * 0.9 + c.rainSeed;
          const gx = Math.sin(t * 1.7 + x * 0.004) * 9 * k;
          const gz = Math.cos(t * 1.3 + z * 0.004) * 9 * k;
          wx += gx; wz += gz;
          gust = Math.max(gust, k * (0.5 + 0.5 * Math.sin(t * 2.3)));
        }
      }
      // Altitude thins the gusts a little; low flight in a cell is the roughest.
      gust *= Math.max(0.45, 1 - y / 6000);
      return { x: wx, z: wz, gust, inside };
    },
    // How hard it is raining on the camera right now, 0..1.
    rainAt(x, z) {
      let r = 0;
      for (const c of this.cells) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < c.r) r = Math.max(r, (1 - d / c.r) * c.strength);
      }
      return r;
    },
    flashAt(x, z) {
      let f = 0;
      for (const c of this.cells) {
        const dx = x - c.x, dz = z - c.z;
        if (Math.sqrt(dx * dx + dz * dz) < c.r * 1.4) f = Math.max(f, c.flash);
      }
      return f;
    },
  };
}
