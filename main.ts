// main.ts — STORMLINE's hand-in program (Node 22, standard library only).
// It gathers the game and its screenshots from beside this file, copies them
// into the grader's output directory, and writes the dossier the judge reads,
// using the kit's vendored library. Run it as:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else cpSync(from, to);
  }
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const gameDir = join(repoRoot, 'game');
  if (!existsSync(join(gameDir, 'index.html'))) {
    throw new Error('game/index.html is missing — nothing to hand in');
  }
  copyTree(gameDir, join(outDir, 'game'));
  const shotsDir = join(repoRoot, 'screenshots');
  if (existsSync(shotsDir)) copyTree(shotsDir, join(outDir, 'screenshots'));
  else mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  // The dossier is the judge's view of the entry: screenshots plus a text of
  // the game's own source, built by the kit library from what we just copied.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
}

main();
