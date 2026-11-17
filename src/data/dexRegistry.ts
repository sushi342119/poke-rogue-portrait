import { Dex, toID } from '@pkmn/dex';

export interface EvolutionRule {
  to: string;
  trigger: 'level' | 'item' | 'friendship' | 'linking-cord';
  level?: number;
  item?: string;
}

export interface RogueSpeciesEntry {
  num: number;
  slug: string;
  zh: string;
  captureRate: number;
  growthRate: number;
  baseExp: number;
  cost: number;
  starter: boolean;
  legendary: boolean;
  evos: EvolutionRule[];
  learnset: [number, string][];
}

export interface RogueDexDatabase {
  generatedAt: string;
  speciesCount: number;
  species: Record<string, RogueSpeciesEntry>;
  movesZh: Record<string, string>;
  abilitiesZh: Record<string, string>;
  items: Record<string, { zh: string; slug: string }>;
  naturesZh: Record<string, string>;
}

let db: RogueDexDatabase = {
  generatedAt: '',
  speciesCount: 0,
  species: {},
  movesZh: {},
  abilitiesZh: {},
  items: {},
  naturesZh: {},
};

const FORM_SUFFIX_ZH: Record<string, string> = {
  alola: '阿罗拉',
  galar: '伽勒尔',
  hisui: '洗翠',
  paldea: '帕底亚',
  paldeacombat: '帕底亚斗战',
  paldeablaze: '帕底亚火炽',
  paldeaaqua: '帕底亚水澜',
  mega: '超级',
  megax: '超级X',
  megay: '超级Y',
  primal: '原始',
  origin: '起源',
  therian: '灵兽',
  incarnate: '化身',
  crowned: '剑之王/盾之王',
  wellspring: '水井面具',
  hearthflame: '火灶面具',
  cornerstone: '础石面具',
  bloodmoon: '赫月',
  duskmane: '黄昏之鬃',
  dawnwings: '拂晓之翼',
  ultra: '究极',
  ice: '白马',
  shadow: '黑马',
  rapidstrike: '连击流',
  blade: '刀剑',
  zen: '达摩',
  galarzen: '伽勒尔达摩',
  sunshine: '晴天',
  rainy: '雨水',
  sunny: '太阳',
  snowy: '雪云',
  wash: '清洗',
  heat: '加热',
  frost: '结冰',
  fan: '旋转',
  mow: '切割',
  midnight: '黑夜',
  dusk: '黄昏',
  busted: '现形',
  hangry: '空腹',
  noice: '解冻',
  hero: '全能',
  terastal: '太晶',
  stellar: '星晶',
};

export function setRogueDexDatabase(data: RogueDexDatabase): void {
  db = data;
}

export function getRogueDexDatabase(): RogueDexDatabase {
  return db;
}

export async function loadRogueDex(url = './data/rogue-dex-zh.json'): Promise<RogueDexDatabase> {
  if (db.speciesCount > 0) return db;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`加载图鉴中文数据库失败: HTTP ${res.status}`);
  }
  const json = (await res.json()) as RogueDexDatabase;
  db = json;
  return db;
}

export function getSpeciesMeta(nameOrId: string): RogueSpeciesEntry | undefined {
  const sp = Dex.species.get(nameOrId);
  const id = toID(sp.exists ? sp.id : nameOrId);
  if (db.species[id]) return db.species[id];
  const baseId = toID(sp.baseSpecies || nameOrId);
  return db.species[baseId];
}

export function getSpeciesZh(nameOrId: string): string {
  if (!nameOrId) return '';
  const sp = Dex.species.get(nameOrId);
  const id = toID(sp.exists ? sp.id : nameOrId);
  if (db.species[id]?.zh) {
    return db.species[id].zh;
  }
  if (sp.exists && sp.baseSpecies) {
    const baseId = toID(sp.baseSpecies);
    const baseZh = db.species[baseId]?.zh || sp.baseSpecies;
    if (sp.forme) {
      const formeKey = toID(sp.forme);
      const suffix = FORM_SUFFIX_ZH[formeKey] || sp.forme;
      if (formeKey === 'mega') return `超级${baseZh}`;
      if (formeKey === 'megax') return `超级${baseZh}X`;
      if (formeKey === 'megay') return `超级${baseZh}Y`;
      return `${baseZh}·${suffix}`;
    }
    return baseZh;
  }
  return sp.exists ? sp.name : nameOrId;
}

export function getMoveZh(moveNameOrId: string): string {
  if (!moveNameOrId) return '';
  const id = toID(moveNameOrId);
  if (id === 'struggle') return '挣扎';
  if (id === 'recharge') return '蓄力僵直';
  if (db.movesZh[id]) return db.movesZh[id];
  const mv = Dex.moves.get(id);
  return mv.exists ? mv.name : moveNameOrId;
}

export function getAbilityZh(abilityNameOrId: string): string {
  if (!abilityNameOrId) return '未知';
  const id = toID(abilityNameOrId);
  if (db.abilitiesZh[id]) return db.abilitiesZh[id];
  const ab = Dex.abilities.get(id);
  return ab.exists ? ab.name : abilityNameOrId;
}

export function getItemZh(itemNameOrId: string): string {
  if (!itemNameOrId) return '无携带物';
  const id = toID(itemNameOrId);
  if (db.items[id]?.zh) return db.items[id].zh;
  const it = Dex.items.get(id);
  return it.exists ? it.name : itemNameOrId;
}

export function getItemSlug(itemNameOrId: string): string {
  const id = toID(itemNameOrId);
  if (db.items[id]?.slug) return db.items[id].slug;
  const it = Dex.items.get(id);
  if (it.exists) {
    return it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  return itemNameOrId.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function getNatureZh(natureNameOrId: string): string {
  const id = toID(natureNameOrId);
  if (db.naturesZh[id]) return db.naturesZh[id];
  const nat = Dex.natures.get(id);
  return nat.exists ? nat.name : natureNameOrId;
}

/**
 * 计算招式属性对目标双属性（或太晶单属性）的克制倍率：4 / 2 / 1 / 0.5 / 0.25 / 0
 */
export function getTypeEffectiveness(moveType: string, targetTypes: readonly string[]): number {
  if (!moveType || moveType === '???' || moveType === 'Stellar') return 1;
  const typeObj = Dex.types.get(moveType);
  if (!typeObj.exists) return 1;

  let multiplier = 1;
  for (const defTypeName of targetTypes) {
    const defType = Dex.types.get(defTypeName);
    if (!defType.exists) continue;
    const code = defType.damageTaken[typeObj.name];
    // @pkmn/dex damageTaken encoding: 0 = 1x, 1 = 2x (super-effective), 2 = 0.5x (resist), 3 = 0x (immune)
    if (code === 1) multiplier *= 2;
    else if (code === 2) multiplier *= 0.5;
    else if (code === 3) return 0;
  }
  return multiplier;
}

/**
 * Showdown 侦察浮窗核心指标：计算任意宝可梦在指定等级下的理论速度区间
 * minSpe: 0个体 0努力 减速性格 (×0.9)
 * maxSpe: 31个体 252努力 极速性格 (×1.1)
 * scarfSpe: 携带讲究围巾极速 (×1.5)
 */
export function calcSpeedTierRange(
  speciesNameOrId: string,
  level = 50,
): { baseSpe: number; minSpe: number; neutralSpe: number; maxSpe: number; scarfSpe: number } {
  const sp = Dex.species.get(speciesNameOrId);
  const baseSpe = sp.exists ? sp.baseStats.spe : 80;
  const minRaw = Math.floor(((2 * baseSpe) * level) / 100) + 5;
  const minSpe = Math.floor(minRaw * 0.9);
  const neutralSpe = Math.floor(((2 * baseSpe + 31) * level) / 100) + 5;
  const maxRaw = Math.floor(((2 * baseSpe + 31 + 63) * level) / 100) + 5;
  const maxSpe = Math.floor(maxRaw * 1.1);
  const scarfSpe = Math.floor(maxSpe * 1.5);
  return { baseSpe, minSpe, neutralSpe, maxSpe, scarfSpe };
}

/**
 * 官方 6 种经验成长曲线累计经验值公式（PokeAPI growth_rate_id 1..6）
 * 1: slow, 2: medium, 3: fast, 4: medium-slow, 5: slow-then-very-fast (erratic), 6: fast-then-very-slow (fluctuating)
 */
export function getTotalExpForLevel(growthRateId: number, level: number): number {
  const n = Math.max(1, Math.floor(level));
  if (n <= 1) return 0;
  switch (growthRateId) {
    case 1: // Slow
      return Math.floor((5 * n * n * n) / 4);
    case 3: // Fast
      return Math.floor((4 * n * n * n) / 5);
    case 4: // Medium-Slow
      return Math.max(0, Math.floor((6 / 5) * n * n * n - 15 * n * n + 100 * n - 140));
    case 5: {
      // Erratic
      if (n < 50) return Math.floor((n * n * n * (100 - n)) / 50);
      if (n < 68) return Math.floor((n * n * n * (150 - n)) / 100);
      if (n < 98) return Math.floor((n * n * n * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n * n * n * (160 - n)) / 100);
    }
    case 6: {
      // Fluctuating
      if (n < 15) return Math.floor((n * n * n * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n < 36) return Math.floor((n * n * n * (n + 14)) / 50);
      return Math.floor((n * n * n * (Math.floor(n / 2) + 32)) / 50);
    }
    case 2:
    default: // Medium-Fast
      return n * n * n;
  }
}

export function calcBattleExpGain(
  defeatedSpeciesId: string,
  defeatedLevel: number,
  isTrainerBattle: boolean,
  luckyEggCount = 0,
  expCharmCount = 0,
): number {
  const meta = getSpeciesMeta(defeatedSpeciesId);
  const baseExp = meta?.baseExp || 90;
  const trainerBonus = isTrainerBattle ? 1.5 : 1.0;
  const raw = Math.floor(((baseExp * defeatedLevel) / 5) * trainerBonus) + 12;
  const eggMult = 1 + luckyEggCount * 0.4;
  const charmMult = 1 + expCharmCount * 0.25;
  return Math.max(10, Math.floor(raw * eggMult * charmMult));
}

export function getStartingMovesForLevel(speciesNameOrId: string, level: number): string[] {
  const meta = getSpeciesMeta(speciesNameOrId);
  const moves: string[] = [];

  if (meta && meta.learnset.length > 0) {
    for (const [reqLv, moveId] of meta.learnset) {
      if (reqLv <= level && !moves.includes(moveId)) {
        const mv = Dex.moves.get(moveId);
        if (mv.exists && !mv.isNonstandard) {
          moves.push(mv.id);
        }
      }
    }
  }

  // Keep the latest 4 learned moves (always ensuring at least 1 damaging STAB or Tackle fallback)
  let selected = moves.slice(-4);

  const sp = Dex.species.get(speciesNameOrId);
  if (selected.length === 0) {
    const primaryType = sp.types[0] || 'Normal';
    const fallbackByType: Record<string, string> = {
      Fire: 'ember',
      Water: 'watergun',
      Grass: 'vinewhip',
      Electric: 'thundershock',
      Ice: 'powdersnow',
      Fighting: 'karatechop',
      Poison: 'acid',
      Ground: 'mudslap',
      Flying: 'gust',
      Psychic: 'confusion',
      Bug: 'bugbite',
      Rock: 'rockthrow',
      Ghost: 'astonish',
      Dragon: 'twister',
      Dark: 'bite',
      Steel: 'metalclaw',
      Fairy: 'fairywind',
      Normal: 'tackle',
    };
    selected = [fallbackByType[primaryType] || 'tackle'];
  }

  // Ensure at least one damaging move so Lv.5 starters are never stuck with 4 status moves
  const hasDamaging = selected.some((m) => Dex.moves.get(m).category !== 'Status');
  if (!hasDamaging) {
    const damagingFromLearnset = moves.filter((m) => Dex.moves.get(m).category !== 'Status');
    if (damagingFromLearnset.length > 0) {
      selected[0] = damagingFromLearnset[damagingFromLearnset.length - 1];
    } else {
      selected[0] = 'tackle';
    }
  }

  return selected;
}

export function getNewLevelUpMoves(
  speciesNameOrId: string,
  oldLevel: number,
  newLevel: number,
  currentMoves: readonly string[],
): string[] {
  const meta = getSpeciesMeta(speciesNameOrId);
  if (!meta) return [];
  const currentIds = new Set(currentMoves.map((m) => toID(m)));
  const learned: string[] = [];
  for (const [reqLv, moveId] of meta.learnset) {
    const id = toID(moveId);
    if (reqLv > oldLevel && reqLv <= newLevel && !currentIds.has(id) && !learned.includes(id)) {
      const mv = Dex.moves.get(id);
      if (mv.exists && !mv.isNonstandard) {
        learned.push(mv.id);
      }
    }
  }
  return learned;
}
