#!/usr/bin/env node
/**
 * PokéRogue Portrait 资源与全图鉴简中成长数据同步脚本
 *
 * 功能：
 * 1. 从 PokeAPI/pokeapi (BSD-3-Clause) 拉取官方 CSV 表，编译生成单文件：
 *    `public/data/rogue-dex-zh.json`（涵盖全部 1025 只宝可梦的官方简体中文译名、
 *    捕获率、经验成长曲线、基础经验、精确升级学招表、完整进化链、招式/特性/道具/性格简中字典及 Cost 费用）。
 * 2. 从 pagefaultgames/pokerogue-assets 按白名单提取像素生态场地、中文属性/异常图标、
 *    精灵球动画帧、18 属性像素技能打击序列帧表与核心打击音效（严格排除禁用品牌 Logo）。
 * 3. 从 play.pokemonshowdown.com 拉取宝可梦队伍小图标总表与经典像素训练家立绘供离线秒开。
 *
 * 用法：
 *   node scripts/sync-assets.mjs [--tier=core|full]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const POKEAPI_CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const PR_ASSETS_RAW_BASE = 'https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/beta';
const SHOWDOWN_BASE = 'https://play.pokemonshowdown.com';

const FORBIDDEN_PATTERNS = [/logo/i, /intro_dark/i];

function toID(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * 轻量稳健 CSV 解析器（支持双引号包裹换行与逗号）
 */
function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === '') continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = rows[i][j] ?? '';
    }
    records.push(obj);
  }
  return records;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

async function downloadBinary(url, destPath, optional = false) {
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(url) || pat.test(destPath)) {
      throw new Error(`Security/License Guard: Refusing to sync forbidden brand file: ${url}`);
    }
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  try {
    const existing = await fs.stat(destPath);
    if (existing.size > 0) return true;
  } catch {
    // file does not exist yet
  }
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) {
      console.warn(`  [skip optional ${res.status}] ${url}`);
      return false;
    }
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
  return true;
}

function computeStarterCost(speciesId, isLegendary, isMythical, maxEvoBst) {
  if (isMythical) return 7;
  if (isLegendary) return maxEvoBst >= 660 ? 9 : 7;
  if (maxEvoBst >= 600) return 5; // 准神
  if (maxEvoBst >= 535) return 4; // 御三家 / 高种族主力
  if (maxEvoBst >= 485) return 3;
  if (maxEvoBst >= 430) return 2;
  return 1;
}

async function buildRogueDexJson() {
  console.log('1/3 正在从 PokeAPI 拉取 CSV 并构建 1025 全图鉴简中与肉鸽成长数据库...');

  const csvFiles = [
    'pokemon_species.csv',
    'pokemon_species_names.csv',
    'pokemon.csv',
    'pokemon_evolution.csv',
    'moves.csv',
    'move_names.csv',
    'abilities.csv',
    'ability_names.csv',
    'items.csv',
    'item_names.csv',
    'natures.csv',
    'nature_names.csv',
    'pokemon_moves.csv',
  ];

  const csvRawMap = {};
  await Promise.all(
    csvFiles.map(async (name) => {
      const txt = await fetchText(`${POKEAPI_CSV_BASE}/${name}`);
      csvRawMap[name] = parseCsv(txt);
    }),
  );

  // 1. Items (id -> { id, slug, zh })
  const itemByNum = new Map();
  for (const r of csvRawMap['items.csv']) {
    itemByNum.set(Number(r.id), { num: Number(r.id), slug: r.identifier, id: toID(r.identifier), zh: '' });
  }
  for (const r of csvRawMap['item_names.csv']) {
    const item = itemByNum.get(Number(r.item_id));
    if (!item) continue;
    const lang = Number(r.local_language_id);
    if (lang === 12) item.zh = r.name;
    else if (lang === 4 && !item.zh) item.zh = r.name;
    else if (lang === 9 && !item.zh) item.zh = r.name;
  }
  const itemsDict = {};
  for (const item of itemByNum.values()) {
    itemsDict[item.id] = { zh: item.zh || item.slug, slug: item.slug };
  }

  // 2. Moves (id -> zh, num -> showdownId)
  const moveByNum = new Map();
  for (const r of csvRawMap['moves.csv']) {
    moveByNum.set(Number(r.id), { num: Number(r.id), id: toID(r.identifier), zh: '' });
  }
  for (const r of csvRawMap['move_names.csv']) {
    const mv = moveByNum.get(Number(r.move_id));
    if (!mv) continue;
    const lang = Number(r.local_language_id);
    if (lang === 12) mv.zh = r.name;
    else if (lang === 4 && !mv.zh) mv.zh = r.name;
  }
  const movesZh = {};
  for (const mv of moveByNum.values()) {
    if (mv.zh) movesZh[mv.id] = mv.zh;
  }

  // 3. Abilities
  const abilityByNum = new Map();
  for (const r of csvRawMap['abilities.csv']) {
    if (r.is_main_series !== '1') continue;
    abilityByNum.set(Number(r.id), { id: toID(r.identifier), zh: '' });
  }
  for (const r of csvRawMap['ability_names.csv']) {
    const ab = abilityByNum.get(Number(r.ability_id));
    if (!ab) continue;
    const lang = Number(r.local_language_id);
    if (lang === 12) ab.zh = r.name;
    else if (lang === 4 && !ab.zh) ab.zh = r.name;
  }
  const abilitiesZh = {};
  for (const ab of abilityByNum.values()) {
    if (ab.zh) abilitiesZh[ab.id] = ab.zh;
  }

  // 4. Natures
  const natureByNum = new Map();
  for (const r of csvRawMap['natures.csv']) {
    natureByNum.set(Number(r.id), { id: toID(r.identifier), zh: '' });
  }
  for (const r of csvRawMap['nature_names.csv']) {
    const nat = natureByNum.get(Number(r.nature_id));
    if (!nat) continue;
    const lang = Number(r.local_language_id);
    if (lang === 12) nat.zh = r.name;
    else if (lang === 4 && !nat.zh) nat.zh = r.name;
  }
  const naturesZh = {};
  for (const nat of natureByNum.values()) {
    if (nat.zh) naturesZh[nat.id] = nat.zh;
  }

  // 5. Species & Default Pokemon
  const speciesByNum = new Map();
  const childrenBySpeciesNum = new Map();
  for (const r of csvRawMap['pokemon_species.csv']) {
    const num = Number(r.id);
    const parentNum = r.evolves_from_species_id ? Number(r.evolves_from_species_id) : 0;
    const sp = {
      num,
      slug: r.identifier,
      id: toID(r.identifier),
      zh: '',
      genus: '',
      captureRate: Number(r.capture_rate) || 45,
      growthRateId: Number(r.growth_rate_id) || 2,
      parentNum,
      isBaby: r.is_baby === '1',
      isLegendary: r.is_legendary === '1',
      isMythical: r.is_mythical === '1',
      baseExp: 64,
      evolutions: [],
      levelMoves: [],
      cost: 3,
    };
    speciesByNum.set(num, sp);
    if (parentNum > 0) {
      if (!childrenBySpeciesNum.has(parentNum)) childrenBySpeciesNum.set(parentNum, []);
      childrenBySpeciesNum.get(parentNum).push(num);
    }
  }

  for (const r of csvRawMap['pokemon_species_names.csv']) {
    const sp = speciesByNum.get(Number(r.pokemon_species_id));
    if (!sp) continue;
    const lang = Number(r.local_language_id);
    if (lang === 12) {
      sp.zh = r.name;
      sp.genus = r.genus || sp.genus;
    } else if (lang === 4 && !sp.zh) {
      sp.zh = r.name;
    }
  }

  const defaultPokemonIdToSpeciesNum = new Map();
  for (const r of csvRawMap['pokemon.csv']) {
    if (r.is_default !== '1') continue;
    const pokeId = Number(r.id);
    const spNum = Number(r.species_id);
    const sp = speciesByNum.get(spNum);
    if (sp) {
      sp.baseExp = Number(r.base_experience) || 64;
      defaultPokemonIdToSpeciesNum.set(pokeId, spNum);
    }
  }

  // 6. Evolutions (map parent -> evolved species)
  const seenEvoKey = new Set();
  for (const r of csvRawMap['pokemon_evolution.csv']) {
    const targetNum = Number(r.evolved_species_id);
    const targetSp = speciesByNum.get(targetNum);
    if (!targetSp || !targetSp.parentNum) continue;
    const parentSp = speciesByNum.get(targetSp.parentNum);
    if (!parentSp) continue;

    const dedupKey = `${parentSp.num}->${targetSp.num}`;
    if (seenEvoKey.has(dedupKey)) continue;
    seenEvoKey.add(dedupKey);

    const triggerId = Number(r.evolution_trigger_id);
    const minLevel = r.minimum_level ? Number(r.minimum_level) : undefined;
    const triggerItem = r.trigger_item_id ? itemByNum.get(Number(r.trigger_item_id)) : undefined;
    const heldItem = r.held_item_id ? itemByNum.get(Number(r.held_item_id)) : undefined;

    let evoEntry;
    if (triggerItem) {
      evoEntry = { to: targetSp.id, trigger: 'item', item: triggerItem.slug };
    } else if (triggerId === 2) {
      // 通信进化在单机肉鸽中统一支持联系绳 (linking-cord) 或 Lv.36 自然突破
      evoEntry = { to: targetSp.id, trigger: 'linking-cord', item: heldItem?.slug || 'linking-cord', level: 38 };
    } else if (r.minimum_happiness || r.minimum_affection) {
      evoEntry = { to: targetSp.id, trigger: 'friendship', level: minLevel || 26 };
    } else {
      evoEntry = { to: targetSp.id, trigger: 'level', level: minLevel || 30 };
    }
    parentSp.evolutions.push(evoEntry);
  }

  // 7. Level-Up Learnsets (pick latest version_group_id per default pokemon)
  const latestVgBySpecies = new Map();
  for (const r of csvRawMap['pokemon_moves.csv']) {
    if (r.pokemon_move_method_id !== '1') continue; // 1 = level-up
    const spNum = defaultPokemonIdToSpeciesNum.get(Number(r.pokemon_id));
    if (!spNum) continue;
    const vg = Number(r.version_group_id);
    if (vg > (latestVgBySpecies.get(spNum) || 0)) {
      latestVgBySpecies.set(spNum, vg);
    }
  }

  const rawMovesBySpecies = new Map();
  for (const r of csvRawMap['pokemon_moves.csv']) {
    if (r.pokemon_move_method_id !== '1') continue;
    const spNum = defaultPokemonIdToSpeciesNum.get(Number(r.pokemon_id));
    if (!spNum) continue;
    if (Number(r.version_group_id) !== latestVgBySpecies.get(spNum)) continue;
    const mv = moveByNum.get(Number(r.move_id));
    if (!mv) continue;
    const lvl = Math.max(1, Number(r.level) || 1);
    const ord = Number(r.order) || 0;
    if (!rawMovesBySpecies.has(spNum)) rawMovesBySpecies.set(spNum, []);
    rawMovesBySpecies.get(spNum).push({ lvl, ord, id: mv.id });
  }

  for (const [spNum, list] of rawMovesBySpecies.entries()) {
    list.sort((a, b) => a.lvl - b.lvl || a.ord - b.ord);
    const dedup = [];
    const seenMoves = new Set();
    for (const item of list) {
      const key = `${item.lvl}:${item.id}`;
      if (seenMoves.has(key)) continue;
      seenMoves.add(key);
      // Verify move exists in @pkmn/dex
      const dexMove = Dex.moves.get(item.id);
      if (dexMove && dexMove.exists && !dexMove.isNonstandard) {
        dedup.push([item.lvl, item.id]);
      }
    }
    const sp = speciesByNum.get(spNum);
    if (sp) sp.levelMoves = dedup;
  }

  // 8. Starter Cost calculation using final-evolution BST
  function getMaxLineBst(spNum, visited = new Set()) {
    if (visited.has(spNum)) return 400;
    visited.add(spNum);
    const sp = speciesByNum.get(spNum);
    if (!sp) return 400;
    const dexSp = Dex.species.get(sp.id);
    let maxBst = dexSp?.bst || 400;
    for (const childNum of childrenBySpeciesNum.get(spNum) || []) {
      maxBst = Math.max(maxBst, getMaxLineBst(childNum, visited));
    }
    return maxBst;
  }

  const speciesOut = {};
  for (const sp of speciesByNum.values()) {
    const maxBst = getMaxLineBst(sp.num);
    sp.cost = computeStarterCost(sp.id, sp.isLegendary, sp.isMythical, maxBst);
    const isStarterEligible = sp.parentNum === 0 && !sp.isLegendary && !sp.isMythical;
    // Also mark whether baby has parent=0 (babies are starter-eligible!)
    speciesOut[sp.id] = {
      num: sp.num,
      slug: sp.slug,
      zh: sp.zh || sp.slug,
      captureRate: sp.captureRate,
      growthRate: sp.growthRateId,
      baseExp: sp.baseExp,
      cost: sp.cost,
      starter: isStarterEligible || sp.isLegendary || sp.isMythical,
      legendary: sp.isLegendary || sp.isMythical,
      evos: sp.evolutions,
      learnset: sp.levelMoves,
    };
  }

  const outData = {
    generatedAt: new Date().toISOString(),
    speciesCount: Object.keys(speciesOut).length,
    species: speciesOut,
    movesZh,
    abilitiesZh,
    items: itemsDict,
    naturesZh,
  };

  const outFile = path.join(PUBLIC_DIR, 'data', 'rogue-dex-zh.json');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(outData));
  console.log(
    `  ✓ 已生成 public/data/rogue-dex-zh.json（宝可梦 ${Object.keys(speciesOut).length} 种，招式 ${Object.keys(movesZh).length} 个，特性 ${Object.keys(abilitiesZh).length} 个，道具 ${Object.keys(itemsDict).length} 个）`,
  );
}

async function syncPixelAssets() {
  console.log('2/3 正在从 pokerogue-assets 按白名单同步像素场地、状态徽章、精灵球与 18 属性特效...');

  const biomes = [
    'plains',
    'forest',
    'beach',
    'cave',
    'volcano',
    'snowy_forest',
    'badlands',
    'abyss',
    'laboratory',
  ];

  const tasks = [];

  for (const b of biomes) {
    for (const part of ['bg', 'a', 'b']) {
      tasks.push(
        downloadBinary(
          `${PR_ASSETS_RAW_BASE}/images/arenas/${b}_${part}.png`,
          path.join(PUBLIC_DIR, 'assets/pr/arenas', `${b}_${part}.png`),
          true,
        ),
      );
    }
  }

  const uiFiles = [
    'types_zh-Hans.png',
    'types_zh-Hans.json',
    'statuses_zh-Hans.png',
    'statuses_zh-Hans.json',
    'pb.png',
    'pb.json',
  ];
  for (const f of uiFiles) {
    tasks.push(
      downloadBinary(`${PR_ASSETS_RAW_BASE}/images/${f}`, path.join(PUBLIC_DIR, 'assets/pr/ui', f), true),
    );
  }

  const balls = ['pb', 'gb', 'ub', 'mb'];
  for (const b of balls) {
    for (const suffix of ['', '_opening', '_open']) {
      tasks.push(
        downloadBinary(
          `${PR_ASSETS_RAW_BASE}/images/pokeball/${b}${suffix}.png`,
          path.join(PUBLIC_DIR, 'assets/pr/pokeball', `${b}${suffix}.png`),
          true,
        ),
      );
    }
  }

  const vfxSheets = [
    ['003-Attack01.png', 'strike.png'],
    ['004-Attack02.png', 'slash.png'],
    ['015-Fire01.png', 'fire.png'],
    ['016-Ice01.png', 'ice.png'],
    ['017-Thunder01.png', 'electric.png'],
    ['018-Water01.png', 'water.png'],
    ['022-Darkness01.png', 'dark.png'],
    ['023-Burst01.png', 'burst.png'],
    ['028-State01.png', 'state.png'],
    ['030-Explosion01.png', 'explosion.png'],
    ['DustandGrass.png', 'grass.png'],
    ['Aerial Ace.png', 'flying.png'],
  ];

  for (const [remoteName, localName] of vfxSheets) {
    tasks.push(
      downloadBinary(
        `${PR_ASSETS_RAW_BASE}/images/battle_anims/${encodeURIComponent(remoteName)}`,
        path.join(PUBLIC_DIR, 'assets/pr/vfx', localName),
        true,
      ),
    );
  }

  const sfxFiles = ['hit.wav', 'hit_strong.wav', 'hit_weak.wav', 'faint.wav', 'level_up.wav', 'exp.wav'];
  for (const sfx of sfxFiles) {
    tasks.push(
      downloadBinary(
        `${PR_ASSETS_RAW_BASE}/audio/se/${sfx}`,
        path.join(PUBLIC_DIR, 'assets/pr/se', sfx),
        true,
      ),
    );
  }

  await Promise.all(tasks);
  console.log('  ✓ pokerogue-assets 核心像素包同步完成');
}

async function syncShowdownCoreIcons() {
  console.log('3/3 正在同步 Showdown 队伍小图标总表与训练家像素立绘...');
  const tasks = [
    downloadBinary(
      `${SHOWDOWN_BASE}/sprites/pokemonicons-sheet.png`,
      path.join(PUBLIC_DIR, 'assets/showdown/sprites/pokemonicons-sheet.png'),
      true,
    ),
    downloadBinary(
      `${SHOWDOWN_BASE}/sprites/itemicons-sheet.png`,
      path.join(PUBLIC_DIR, 'assets/showdown/sprites/itemicons-sheet.png'),
      true,
    ),
  ];

  const trainers = ['hilbert', 'hilda', 'red', 'blue', 'cynthia', 'steven', 'n', 'alder', 'ghetsis'];
  for (const t of trainers) {
    tasks.push(
      downloadBinary(
        `${SHOWDOWN_BASE}/sprites/trainers/${t}.png`,
        path.join(PUBLIC_DIR, 'assets/showdown/sprites/trainers', `${t}.png`),
        true,
      ),
    );
  }

  await Promise.all(tasks);
  console.log('  ✓ Showdown 核心图标与训练家立绘同步完成');
}

async function main() {
  const start = Date.now();
  await buildRogueDexJson();
  await syncPixelAssets();
  await syncShowdownCoreIcons();
  console.log(`\n全部资源同步完成！耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('同步失败:', err);
  process.exit(1);
});
