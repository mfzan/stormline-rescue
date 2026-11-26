// flight-model.js — the STORMLINE flight model: a STOL bush plane with real
// trade-offs. Lift grows with speed squared, so below stall speed the wing quits
// and the nose drops; flaps lower the stall speed but add drag; banked turns bleed
// speed; gusts and storm cells push the airframe around. Fuel and damage are the
// two clocks on every sortie: run either one out and the mountain decides.

export const STALL_CLEAN_KT = 55;
export const STALL_FLAP_KT = 42;
export const VNE_KT = 150; // never-exceed: past this the airframe takes damage
export const CRUISE_KT = 105;
export const KT_TO_MS = 0.514444;
export const GRAVITY = 9.81;

export function createPlane(strip) {
  const hdg = (strip.hdg * Math.PI) / 180;
  return {
    // Position in metres (y = altitude above sea level), heading radians.
    x: strip.x, y: strip.elev + 2, z: strip.z,
    heading: hdg, pitch: 0, roll: 0,
    speedKt: 0, throttle: 0, flaps: 0, // flaps 0..1
    vsFpm: 0, // vertical speed, feet per minute
    fuel: 100, damage: 0,
    airborne: false, onGround: true,
    gLoad: 1, stalled: false,
    // Controls, set by input.js each frame (-1..1, throttle 0..1).
    ctrl: { pitch: 0, roll: 0, throttle: 0, flaps: false },
    // Per-frame weather push, filled by weather.js.
    wind: { x: 0, z: 0, gust: 0 },
    // For the debrief: smoothest landing, hardest hit.
    hardestLandingFpm: 0,
  };
}

// One fixed step of the flight model. dt is seconds (clamped by the caller).
export function stepFlight(p, dt, groundHeightAt, windAt) {
  const c = p.ctrl;
  // Throttle spools toward the lever, flaps deploy or retract slowly.
  p.throttle += (c.throttle - p.throttle) * Math.min(1, dt * 1.4);
  const flapTarget = c.flaps ? 1 : 0;
  p.flaps += (flapTarget - p.flaps) * Math.min(1, dt * 0.8);

  const v = p.speedKt * KT_TO_MS;
  const stallKt = STALL_CLEAN_KT - (STALL_CLEAN_KT - STALL_FLAP_KT) * p.flaps;
  p.stalled = p.airborne && p.speedKt < stallKt;

  // Drag: parasite drag grows with speed squared, flaps add a flat chunk.
  // Numbers tuned so the STOL lifts off in ~7 s, cruises 105 kt at 65%
  // throttle, and tops out near 130 kt level — past 150 kt the airframe
  // complains (see the VNE check below).
  const drag = 0.00107 * v * v + p.flaps * 1.1;
  // Thrust: full throttle overcomes drag up to about 130 kt level.
  const thrust = p.throttle * 4.8;
  const accelMs = thrust - drag - Math.sin(p.pitch) * GRAVITY * 0.55;
  p.speedKt = Math.max(0, p.speedKt + (accelMs / KT_TO_MS) * dt);

  // Roll: ailerons bank the wings; the bank rate fades as the wing stalls.
  const rollAuthority = p.stalled ? 0.35 : 1;
  const targetRoll = c.roll * 0.85 * rollAuthority;
  p.roll += (targetRoll - p.roll) * Math.min(1, dt * 2.2);
  // Turn: a banked wing turns the nose. Turn rate = g * tan(bank) / speed.
  // (The clamped speed below is only for the turn rate — the plane's position
  // uses its true speed, so a parked plane never slides along the ground.)
  const turnSpeedMs = Math.max(12, p.speedKt * KT_TO_MS);
  const turnRate = (GRAVITY * Math.tan(p.roll)) / turnSpeedMs;
  p.heading += turnRate * dt;

  // Pitch: elevator authority grows with speed; a stalled wing drops the nose.
  const pitchAuthority = Math.min(1, p.speedKt / 70) * (p.stalled ? 0.4 : 1);
  const targetPitch = p.stalled ? -0.22 : c.pitch * 0.32 * pitchAuthority;
  p.pitch += (targetPitch - p.pitch) * Math.min(1, dt * 2.0);
  // Climb: pitch converts speed into altitude; a stalled wing sinks instead.
  const climbMs = p.stalled
    ? -6.5
    : Math.sin(p.pitch) * p.speedKt * KT_TO_MS * 0.5 - (p.flaps * 0.9);
  p.vsFpm = climbMs * 196.85;
  p.y += climbMs * dt;

  // Wind: the air mass itself moves the plane over the ground — but only once
  // it is moving; a parked plane does not slide with the wind.
  const w = windAt(p.x, p.z, p.y);
  p.wind = w;
  const groundSpeed = p.speedKt * KT_TO_MS;
  if (p.airborne || p.speedKt > 5) {
    p.x += (Math.sin(p.heading) * groundSpeed + w.x) * dt;
    p.z += (-Math.cos(p.heading) * groundSpeed + w.z) * dt;
  }

  // G load: banked turns and turbulence load the airframe.
  p.gLoad = 1 / Math.max(0.45, Math.cos(p.roll)) + Math.abs(w.gust) * 0.06;
  if (p.speedKt > VNE_KT || p.gLoad > 3.2) {
    p.damage += (p.speedKt > VNE_KT ? 2.2 : 1.4) * dt;
  }

  // Fuel: thirsty at full throttle, sipping at cruise.
  p.fuel -= (0.028 + p.throttle * 0.055) * dt * (p.airborne ? 1 : 0.4);
  if (p.fuel <= 0) {
    p.fuel = 0;
    p.throttle = Math.max(p.throttle - dt * 0.5, 0);
  }

  // Ground contact: landing, rolling, or a crash into the mountain.
  const ground = groundHeightAt(p.x, p.z);
  const wasAirborne = p.airborne;
  if (p.y <= ground + 2) {
    if (p.airborne) {
      const hitFpm = Math.abs(p.vsFpm);
      p.hardestLandingFpm = Math.max(p.hardestLandingFpm, hitFpm);
      p.landingVsFpm = p.vsFpm;
      p.airborne = false;
    }
    p.y = ground + 2;
    p.onGround = true;
    // The nose stays down until rotation speed: above ~45 kt the pilot may
    // rotate, the wing lifts the plane off, and the ground lets go of it.
    if (p.speedKt < 45) p.pitch = 0;
    p.roll *= 0.6;
    // Rolling drag slows the plane; brakes are the pitch-down key on the ground.
    // (Rolling drag stays small: the engine must beat it, or nothing takes off.)
    p.speedKt = Math.max(0, p.speedKt - (1.5 + (c.pitch < -0.3 ? 26 : 0)) * dt);
    // Parked with the engine at idle, stop the last creep — but never snap the
    // speed to zero while the throttle is open, or the plane can never start
    // rolling at all (that dead zone grounded every takeoff before).
    if (p.speedKt < 0.5 && p.throttle < 0.05) p.speedKt = 0;
  } else {
    p.onGround = false;
    if (p.speedKt > stallKt * 0.9) p.airborne = true;
    // First lift-off of the sortie: the plane has now truly flown, so later
    // ground contact counts as a landing (and clears the last one's flag).
    if (p.airborne && !wasAirborne) {
      p.hasFlown = true;
      p.wasLanded = false;
    }
  }
  p.damage = Math.min(100, p.damage);
  return p;
}

// A landing counts when the wheels are on a strip, slow, and descending gently.
export function landingQuality(p, strip, groundHeightAt) {
  if (!strip) return null;
  const dx = p.x - strip.x, dz = p.z - strip.z;
  const dirX = Math.sin((strip.hdg * Math.PI) / 180);
  const dirZ = -Math.cos((strip.hdg * Math.PI) / 180);
  const along = Math.abs(dx * dirX + dz * dirZ);
  const across = Math.abs(dx * dirZ - dz * dirX);
  if (along > strip.len / 2 + 30 || across > 42) return null;
  if (!p.onGround) return null;
  const vs = Math.abs(p.landingVsFpm ?? 9999);
  if (p.speedKt > 92) return { ok: false, why: 'too fast', vs };
  if (vs > 620) return { ok: false, why: 'too hard', vs };
  return { ok: true, vs, smooth: vs < 300 };
}
