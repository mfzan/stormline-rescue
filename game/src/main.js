// main.js — STORMLINE: a STOL bush pilot flying rescue sorties through live
// storm fronts in the high Andes. One game loop, one state machine:
// menu -> briefing -> flying -> (pickup | return) -> debrief, with crash and
// forced-landing exits. Deterministic `?shot=` scenes stage the four screenshots.

import { buildTerrain, STRIPS, WORLD_SIZE } from './terrain.js';
import { createPlane, stepFlight, landingQuality } from './flight-model.js';
import { createWeather } from './weather.js';
import { MISSIONS, missionById, targetStrip, legStrip, buildRings, scoreSortie, HOME_STRIP } from './missions.js';
import { createRenderer } from './render.js';
import { drawHud, setHudCtx } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || null;
const SEED = Number(params.get('seed') || 7);

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
const terrain = buildTerrain(SEED);
const weather = createWeather(SEED * 13 + 5);

const game = {
  state: 'menu', // menu | briefing | flying | debrief | crashed
  mission: MISSIONS[0],
  selectedMission: 0,
  plane: null,
  rings: [],
  weather,
  terrain,
  camera: 'chase',
  time: 0,
  banner: null,
  phase: 'outbound', // outbound | pickup | return
  stats: null,
  crashWhy: '',
  score: 0,
  muted: false,
  paused: false,
  flashThunderAt: 0,
};

function setBanner(text, sub, color, seconds = 2.4) {
  game.banner = { text, sub: sub || '', color: color || '#ffffff', until: game.time + seconds };
}

function startMission(id) {
  const mission = missionById(id);
  game.mission = mission;
  game.plane = createPlane(HOME_STRIP);
  game.plane.fuel = mission.fuel;
  game.legIndex = 0;
  game.rings = buildRings(mission, terrain, HOME_STRIP, legStrip(mission, 0));
  game.phase = 'outbound';
  game.stats = {
    ringsHit: 0, ringsTotal: game.rings.length,
    smoothLanding: false, fuelLeft: mission.fuel,
    damageTaken: 0, timeSec: 0, startTime: game.time,
  };
  game.camera = 'chase';
  game.state = 'flying';
  weather.baseWind.kt = mission.wind;
  setBanner(mission.name.toUpperCase(), 'Take off from Pampa Alta — follow the amber rings', '#ffb042', 3.2);
}

function finishPickup() {
  game.phase = 'return';
  game.rings = [finalHomeRing()];
  game.stats.ringsTotal += 1;
  setBanner('CLIMBERS ABOARD', 'Bring them home — land at Pampa Alta', '#7ddc8a', 3);
  audio.beep(660);
}

function finalHomeRing() {
  const hdg = (HOME_STRIP.hdg * Math.PI) / 180;
  return {
    x: HOME_STRIP.x - Math.sin(hdg) * 900,
    y: HOME_STRIP.elev + 150,
    z: HOME_STRIP.z + Math.cos(hdg) * 900,
    r: 48, passed: false,
  };
}

function endSortie(success, why) {
  const p = game.plane;
  const stats = game.stats;
  stats.timeSec = Math.round(game.time - stats.startTime);
  stats.fuelLeft = Math.round(p.fuel);
  stats.damageTaken = Math.round(p.damage);
  if (success) {
    game.score = scoreSortie(game.mission, stats);
    game.state = 'debrief';
    setBanner('', '');
    audio.beep(990);
  } else {
    game.crashWhy = why;
    game.state = 'crashed';
    audio.thud();
  }
}

function checkRings() {
  const p = game.plane;
  const next = game.rings.find((r) => !r.passed);
  if (!next) return;
  const dx = p.x - next.x, dy = p.y - next.y, dz = p.z - next.z;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) < next.r + 20) {
    next.passed = true;
    game.stats.ringsHit++;
    audio.beep(880);
    const left = game.rings.filter((r) => !r.passed).length;
    setBanner(`RING ${game.stats.ringsHit}/${game.rings.length}`, left ? `${left} to go` : 'All rings — line up for the strip', '#ffb042', 1.6);
  }
}

function currentTargetStrip() {
  return game.phase === 'return' ? HOME_STRIP : legStrip(game.mission, game.legIndex);
}

function advanceLeg() {
  // Another leg to fly: new gates from this strip to the next target.
  const from = legStrip(game.mission, game.legIndex);
  game.legIndex++;
  game.rings = buildRings(game.mission, terrain, from, legStrip(game.mission, game.legIndex));
  game.stats.ringsTotal += game.rings.length;
  game.phase = 'outbound';
  const next = legStrip(game.mission, game.legIndex);
  setBanner(`NEXT LEG — ${next.name.toUpperCase()}`, `Leg ${game.legIndex + 1} of ${game.mission.legs.length} — follow the amber rings`, '#ffb042', 3);
}

function checkLanding() {
  const p = game.plane;
  if (!p.onGround || p.wasLanded || !p.hasFlown) return;
  const target = currentTargetStrip();
  const q = landingQuality(p, target, (x, z) => terrain.heightAt(x, z));
  if (q) {
    p.wasLanded = true;
    game.stats.smoothLanding = q.ok && q.smooth;
    if (!q.ok) {
      p.damage += q.why === 'too hard' ? 22 : 8;
      setBanner('ROUGH LANDING', q.why === 'too hard' ? 'That one hurt the airframe' : 'Too fast over the threshold', '#ff5a4e', 2.5);
      audio.thud();
    } else {
      audio.thud();
      if (game.phase === 'outbound') {
        if (game.legIndex < game.mission.legs.length - 1) {
          advanceLeg();
        } else if (game.mission.kind === 'supply') {
          setBanner('CRATE DELIVERED', 'Medicine is on the ground — head home', '#7ddc8a', 3);
          game.phase = 'return';
          game.rings = [finalHomeRing()];
          game.stats.ringsTotal += 1;
        } else {
          setBanner('ON THE STRIP', 'Loading the climbers…', '#7ddc8a', 2.2);
          game.phase = 'pickup';
          game.pickupAt = game.time + 2.2;
        }
      } else {
        endSortie(true, '');
      }
    }
    return;
  }
  // Not on a strip: a hard arrival in the mountains is a crash, a gentle one a
  // forced landing — either way the sortie is over.
  if (p.airborne === false && p.y <= terrain.heightAt(p.x, p.z) + 2.1) {
    const vs = Math.abs(p.landingVsFpm ?? 0);
    if (vs > 500 || p.speedKt > 70) {
      endSortie(false, 'Crashed into the mountainside — the ridge always wins a rushed approach.');
    } else {
      endSortie(false, 'Forced landing away from any strip — the climbers are still waiting.');
    }
  }
}

function step(dt) {
  game.time += dt;
  weather.step(dt);
  if (game.flashThunderAt && game.time >= game.flashThunderAt) {
    game.flashThunderAt = 0;
  }
  // Thunder follows a strike inside earshot.
  for (const c of weather.cells) {
    if (c.flash > 0.9 && !c.thundered) {
      c.thundered = true;
      const d = Math.hypot(game.plane ? game.plane.x - c.x : 0, game.plane ? game.plane.z - c.z : 0);
      if (d < c.r * 2.2) audio.thunder();
    }
    if (c.flash <= 0.05) c.thundered = false;
  }

  if (game.state === 'flying' && game.plane) {
    const p = game.plane;
    const c = input.readControls();
    // Throttle lever: W spools up, S spools down, held position otherwise.
    if (c.throttle === 'up') p.ctrl.throttle = Math.min(1, p.ctrl.throttle + dt * 0.55);
    if (c.throttle === 'down') p.ctrl.throttle = Math.max(0, p.ctrl.throttle - dt * 0.55);
    p.ctrl.pitch = c.pitch;
    p.ctrl.roll = c.roll;
    if (input.wasPressed('KeyF')) p.ctrl.flaps = !p.ctrl.flaps;
    if (input.wasPressed('KeyC')) game.camera = game.camera === 'chase' ? 'cockpit' : 'chase';
    if (input.wasPressed('KeyM')) game.muted = audio.toggleMute();
    if (input.wasPressed('KeyP')) game.paused = !game.paused;
    if (game.paused) return;

    const wasAirborne = p.airborne;
    stepFlight(p, dt, (x, z) => terrain.heightAt(x, z), (x, z, y) => weather.windAt(x, z, y));
    if (p.airborne && !wasAirborne) setBanner('AIRBORNE', 'Gear up in your head — flaps as needed', '#ffffff', 1.6);
    if (p.fuel <= 0 && !p.fuelWarned) {
      p.fuelWarned = true;
      setBanner('FUEL EMPTY', 'Gliding now — find a strip or a flat valley', '#ff5a4e', 3);
    }
    if (p.damage >= 100) {
      endSortie(false, 'The airframe gave up — too much damage from speed, gusts and hard landings.');
      return;
    }
    // Off the map edge: turn back, the range is the whole world.
    if (Math.abs(p.x) > WORLD_SIZE / 2 - 200 || Math.abs(p.z) > WORLD_SIZE / 2 - 200) {
      setBanner('EDGE OF THE RANGE', 'Turn back — there is nothing out there but more mountains', '#ffb042', 2);
      p.heading += Math.PI * dt * 0.4;
    }
    checkRings();
    checkLanding();
    if (game.phase === 'pickup' && game.time >= (game.pickupAt || 0)) finishPickup();
    audio.setFlight({
      throttle: p.throttle,
      speedKt: p.speedKt,
      rain: weather.rainAt(p.x, p.z),
      stalled: p.stalled,
    });
  }
}

function drawMenu() {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  // Backdrop: the world from a slow cinematic orbit.
  const orbit = game.time * 0.02;
  const ghost = {
    x: Math.sin(orbit) * 4200, y: 2600, z: Math.cos(orbit) * 4200,
    heading: orbit + Math.PI, pitch: -0.12, roll: 0,
    speedKt: 90, throttle: 0.6, flaps: 0, vsFpm: 0, fuel: 100, damage: 0,
    airborne: true, onGround: false, gLoad: 1, stalled: false,
    ctrl: { pitch: 0, roll: 0, throttle: 0, flaps: false },
    wind: { x: 0, z: 0, gust: 0 },
  };
  renderer.render({ terrain, plane: ghost, weather, rings: [], camera: 'chase', time: game.time });
  ctx.fillStyle = 'rgba(8,10,16,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffb042';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText('MAKE.FUN — BEST FLIGHT GAME', 48, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px system-ui, sans-serif';
  ctx.fillText('STORMLINE', 46, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '500 19px system-ui, sans-serif';
  ctx.fillText('Fly a STOL bush plane through live storm fronts to rescue', 48, 162);
  ctx.fillText('stranded climbers from six mountain strips in the high Andes.', 48, 188);
  // Mission list.
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillStyle = '#ffb042';
  ctx.fillText('CHOOSE A SORTIE — CLICK TO FLY', 48, 232);
  game.menuButtons = [];
  MISSIONS.forEach((m, i) => {
    const y = 246 + i * 42;
    const sel = i === game.selectedMission;
    ctx.fillStyle = sel ? 'rgba(255,176,66,0.16)' : 'rgba(12,14,20,0.55)';
    ctx.beginPath();
    ctx.roundRect(48, y, 560, 40, 8);
    ctx.fill();
    ctx.strokeStyle = sel ? '#ffb042' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(48, y, 560, 40, 8);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`${i + 1}. ${m.name}`, 62, y + 17);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(`${m.kind.toUpperCase()}  ·  $${m.pay}  ·  wind ${m.wind} kt  ·  ${'★'.repeat(m.stars || 1)}`, 62, y + 33);
    ctx.fillStyle = '#ffb042';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('FLY →', 594, y + 24);
    ctx.textAlign = 'left';
    game.menuButtons.push({ x: 48, y, w: 560, h: 40, mission: m.id });
  });
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText('Arrows fly · W/S throttle · F flaps · C camera · P pause · M mute', 48, H - 32);
  ctx.fillText('9 missions · 6 strips · 3 storm cells · fuel and damage decide if you make it home', 48, H - 56);
}

function drawBriefing() {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 0, W, H);
  const m = game.mission;
  const strip = targetStrip(m);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffb042';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(`SORTIE ${m.id + 1} — ${m.kind.toUpperCase()}`, 80, 90);
  ctx.fillStyle = '#fff';
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.fillText(m.name, 78, 142);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '500 18px system-ui, sans-serif';
  wrapText(ctx, m.brief, 80, 182, W - 160, 28);
  ctx.fillStyle = '#ffb042';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(`TARGET STRIP  ${strip.name.toUpperCase()}  ·  ELEV ${Math.round(strip.elev * 3.28)} FT  ·  ${strip.len} M  ·  DIFFICULTY ${'★'.repeat(strip.diff)}`, 80, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillText(`Pay $${m.pay}  ·  ring gates mark the valley route  ·  wind ${m.wind} kt  ·  fuel ${m.fuel}%`, 80, 330);
  if (m.legs.length > 1) {
    ctx.fillStyle = '#ffb042';
    ctx.fillText(`${m.legs.length} legs — ${m.legs.map((id) => STRIPS.find((x) => x.id === id).name).join(' → ')}`, 80, 356);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Take off from Pampa Alta, fly the amber rings, land on the strip.', 80, 360);
  ctx.fillText('Flaps down and slow over the threshold — a hard landing costs airframe.', 80, 386);
  game.flyButton = { x: 80, y: 430, w: 240, h: 56 };
  ctx.fillStyle = '#ffb042';
  ctx.beginPath(); ctx.roundRect(80, 430, 240, 56, 10); ctx.fill();
  ctx.fillStyle = '#1a1206';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FLY THIS SORTIE', 200, 466);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText('or press Enter — Esc returns to the mission list', 80, 520);
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return yy;
}

function drawDebrief() {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 0, W, H);
  const s = game.stats;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7ddc8a';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText('SORTIE COMPLETE', 80, 90);
  ctx.fillStyle = '#fff';
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.fillText(game.mission.name, 78, 142);
  ctx.fillStyle = '#ffb042';
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(`SCORE  $${game.score}`, 80, 196);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '500 17px system-ui, sans-serif';
  const rows = [
    `Rings flown: ${s.ringsHit}/${s.ringsTotal}`,
    `Time: ${Math.floor(s.timeSec / 60)}:${String(s.timeSec % 60).padStart(2, '0')}`,
    `Fuel left: ${s.fuelLeft}%`,
    `Airframe damage: ${s.damageTaken}%`,
    s.smoothLanding ? 'Landing: smooth — the climbers barely felt it' : 'Landing: firm — the strip forgives, the airframe remembers',
  ];
  rows.forEach((r, i) => ctx.fillText(r, 80, 240 + i * 30));
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('Enter — fly another sortie   ·   Esc — mission list', 80, 440);
}

function drawCrashed() {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#160d0d';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ff5a4e';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText('SORTIE LOST', 80, 90);
  ctx.fillStyle = '#fff';
  ctx.font = '800 40px system-ui, sans-serif';
  ctx.fillText(game.mission.name, 78, 142);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '500 18px system-ui, sans-serif';
  wrapText(ctx, game.crashWhy, 80, 190, W - 160, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('R — try the sortie again   ·   Esc — mission list', 80, 300);
}

function draw() {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  setHudCtx(ctx);
  if (game.state === 'menu') { drawMenu(); return; }
  if (game.state === 'briefing') { drawBriefing(); return; }
  if (game.state === 'debrief') { drawDebrief(); return; }
  if (game.state === 'crashed') { drawCrashed(); return; }
  // Flying (or paused).
  renderer.render({ terrain, plane: game.plane, weather, rings: game.rings, camera: game.camera, time: game.time });
  drawHud(ctx, W, H, {
    plane: game.plane, mission: game.mission, rings: game.rings,
    weather, camera: game.camera, banner: game.banner, time: game.time,
    stats: game.stats, target: currentTargetStrip(), leg: game.legIndex + 1,
    legs: game.mission.legs.length,
  });
  if (game.paused) {
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '800 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText('P to resume', W / 2, H / 2 + 34);
    ctx.textAlign = 'left';
  }
}

function handleInput() {
  const click = input.takeClick();
  if (click) audio.start();
  if (game.state === 'menu') {
    if (input.wasPressed('Enter')) {
      game.mission = missionById(game.selectedMission);
      game.state = 'briefing';
      return;
    }
    for (let i = 0; i < 9; i++) {
      if (input.wasPressed(`Digit${i + 1}`)) {
        game.selectedMission = i;
        game.mission = missionById(i);
        game.state = 'briefing';
        return;
      }
    }
    if (click && game.menuButtons) {
      for (const b of game.menuButtons) {
        if (click.x >= b.x && click.x <= b.x + b.w && click.y >= b.y && click.y <= b.y + b.h) {
          game.mission = missionById(b.mission);
          game.state = 'briefing';
          return;
        }
      }
    }
    return;
  }
  if (game.state === 'briefing') {
    if (input.wasPressed('Enter') || (click && game.flyButton
      && click.x >= game.flyButton.x && click.x <= game.flyButton.x + game.flyButton.w
      && click.y >= game.flyButton.y && click.y <= game.flyButton.y + game.flyButton.h)) {
      audio.start();
      startMission(game.mission.id);
      return;
    }
    if (input.wasPressed('Escape')) game.state = 'menu';
    return;
  }
  if (game.state === 'debrief') {
    if (input.wasPressed('Enter')) { game.state = 'menu'; return; }
    if (input.wasPressed('Escape')) { game.state = 'menu'; return; }
    return;
  }
  if (game.state === 'crashed') {
    if (input.wasPressed('KeyR')) { startMission(game.mission.id); return; }
    if (input.wasPressed('Escape')) { game.state = 'menu'; return; }
  }
}

// ---- Deterministic screenshot scenes (used by shots.json, never by players) ----
function stageShot() {
  if (!SHOT) return;
  if (SHOT === 'map') { game.state = 'menu'; return; }
  const missionId = SHOT === 'cover' ? 3 : 0; // cover: Storm Front; approach + rescue: First Light
  const mission = missionById(missionId);
  game.mission = mission;
  game.plane = createPlane(HOME_STRIP);
  game.plane.fuel = mission.fuel;
  game.rings = buildRings(mission, terrain, HOME_STRIP, targetStrip(mission));
  weather.baseWind.kt = mission.wind;
  game.state = 'flying';
  const p = game.plane;
  if (SHOT === 'cover') {
    // Mid-flight inside a storm cell parked on the route, second ring ahead,
    // Cerro Torre's snowy peak beyond it. Park the plane 900 m short of the
    // ring so it reads big above the nose, level with it.
    const cell = weather.cells[0];
    const ring0 = game.rings[0], ring1 = game.rings[1];
    const dirX = (ring1.x - ring0.x) / Math.hypot(ring1.x - ring0.x, ring1.z - ring0.z);
    const dirZ = (ring1.z - ring0.z) / Math.hypot(ring1.x - ring0.x, ring1.z - ring0.z);
    cell.x = ring1.x - dirX * 450;
    cell.z = ring1.z - dirZ * 450;
    cell.flash = 0.5; // a strike just lit the cell
    p.x = ring1.x - dirX * 900;
    p.z = ring1.z - dirZ * 900;
    p.y = ring1.y - 20; // level with the next ring, so it reads above the nose
    p.heading = Math.atan2(ring1.x - p.x, -(ring1.z - p.z));
    p.speedKt = 102; p.throttle = 0.72; p.airborne = true; p.onGround = false;
    p.pitch = 0.04; p.roll = 0.18; p.vsFpm = 120;
    game.rings[0].passed = true;
    game.stats = { ringsHit: 1, ringsTotal: game.rings.length, smoothLanding: false, fuelLeft: 88, damageTaken: 2, timeSec: 0, startTime: 0 };
    setBanner('STORM FRONT', `Ride the gusts — ring 2 of ${game.rings.length} ahead`, '#ffb042', 30);
  } else if (SHOT === 'approach') {
    // Cockpit view on final to Laguna Verde: a valley strip with the lake
    // beside it and snowy peaks behind, rain falling on the windscreen.
    const strip = targetStrip(mission);
    const hdg = (strip.hdg * Math.PI) / 180;
    // Close and low on final: 900 m out, 170 m above the strip, nose down
    // toward the threshold — the runway reads big and centred, with the
    // six-pack lit on the glareshield and the lake and peaks behind it.
    p.x = strip.x - Math.sin(hdg) * 900;
    p.z = strip.z + Math.cos(hdg) * 900;
    p.y = strip.elev + 170;
    p.heading = hdg;
    p.speedKt = 74; p.throttle = 0.42; p.airborne = true; p.onGround = false;
    p.pitch = -0.12; p.roll = 0.03; p.flaps = 1; p.vsFpm = -380;
    game.camera = 'cockpit';
    game.rings.forEach((r) => { r.passed = true; });
    game.stats = { ringsHit: game.rings.length, ringsTotal: game.rings.length, smoothLanding: false, fuelLeft: 61, damageTaken: 0, timeSec: 0, startTime: 0 };
    const cell = weather.cells[1];
    cell.x = p.x + 400; cell.z = p.z - 600;
    setBanner('FINAL — LAGUNA VERDE', 'Flaps down · 74 kt · keep the threshold centred', '#ffffff', 30);
  } else if (SHOT === 'rescue') {
    // On the ground at Laguna Verde, climbers aboard, storm behind. No rings:
    // the job here is done, and the strip is the picture.
    const strip = targetStrip(mission);
    p.x = strip.x; p.z = strip.z;
    p.y = strip.elev + 2;
    p.heading = (strip.hdg * Math.PI) / 180;
    p.speedKt = 0; p.throttle = 0; p.airborne = false; p.onGround = true; p.vsFpm = 0;
    const ringCount = game.rings.length;
    game.rings = [];
    game.stats = { ringsHit: ringCount, ringsTotal: ringCount, smoothLanding: true, fuelLeft: 72, damageTaken: 0, timeSec: 0, startTime: 0 };
    setBanner('CLIMBERS ABOARD', 'Laguna Verde pickup complete — fuel 72% for the flight home', '#7ddc8a', 30);
  }
  game.phase = 'outbound';
}

// ---- Boot and loop ----
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
stageShot();

// Debug hook for play-testing (read-only state; the game never writes through it).
window.__stormline = game;

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  handleInput();
  // In shot mode the scene is staged and the plane holds its pose; the world
  // (weather, rain, clouds) still moves so the render is alive.
  if (SHOT && game.state === 'flying') {
    game.time += dt;
    weather.step(dt);
    // Staged shots still show live instruments: wind, gusts, rain.
    if (game.plane) game.plane.wind = weather.windAt(game.plane.x, game.plane.z, game.plane.y);
    if (SHOT === 'cover') weather.cells[0].flash = 0.5;
  } else {
    step(dt);
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
