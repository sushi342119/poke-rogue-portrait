import { Dex, toID } from '@pkmn/sim';
import { getRogueDexDatabase } from '../data/dexRegistry';
import {
  SaveStorage,
  getDefaultUpgradeRecord,
  type EggTier,
  type GachaMachineType,
  type HatchedEggResult,
  type IncubatingEgg,
  type VoucherTier,
} from './SaveStorage';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * PokéRogue 人气初始宠手工精选超模蛋招式表（前 3 槽为精良蛋招式，第 4 槽为稀有王牌蛋招式！）
 */
const CURATED_EGG_MOVES: Record<string, [string, string, string, string]> = {
  bulbasaur: ['Earth Power', 'Weather Ball', 'Matcha Gotcha', 'Fiery Dance'],
  charmander: ['Dragon Pulse', 'Earth Power', 'Bitter Blade', 'Eruption'],
  squirtle: ['Aura Sphere', 'Freeze-Dry', 'Ice Spinner', 'Shell Smash'],
  chikorita: ['Earth Power', 'Strength Sap', 'Sappy Seed', 'Quiver Dance'],
  cyndaquil: ['Scorching Sands', 'Thunderbolt', 'Fiery Dance', 'Eruption'],
  totodile: ['Dragon Dance', 'Thunder Punch', 'Triple Axel', 'Surging Strikes'],
  treecko: ['Aura Sphere', 'Dragon Pulse', 'Nasty Plot', 'Make It Rain'],
  torchic: ['Thunderous Kick', 'High Jump Kick', 'Swords Dance', 'Pyro Ball'],
  mudkip: ['Icicle Crash', 'Bulk Up', 'Flip Turn', 'Jet Punch'],
  turtwig: ['Icicle Crash', 'Rock Slide', 'Sleep Powder', 'Shell Smash'],
  chimchar: ['Drain Punch', 'Ice Punch', 'Pyro Ball', 'Victory Dance'],
  piplup: ['Roost', 'Freeze-Dry', 'Flip Turn', 'Tachyon Cutter'],
  snivy: ['Flamethrower', 'Earth Power', 'Clanging Scales', 'Fleur Cannon'],
  tepig: ['High Horsepower', 'Drain Punch', 'Dragon Dance', 'Victory Dance'],
  oshawott: ['Sacred Sword', 'Icicle Spear', 'Flip Turn', 'Surging Strikes'],
  chespin: ['Drain Punch', 'Iron Head', 'Spiky Shield', 'Horn Leech'],
  fennekin: ['Thunderbolt', 'Moonblast', 'Aura Sphere', 'Torch Song'],
  froakie: ['Earth Power', 'Moonblast', 'Nasty Plot', 'Steam Eruption'],
  rowlet: ['Thousand Arrows', 'First Impression', 'Victory Dance', 'Triple Arrows'],
  litten: ['Parting Shot', 'Drain Punch', 'Knock Off', 'Bitter Blade'],
  popplio: ['Freeze-Dry', 'Psychic Noise', 'Alluring Voice', 'Torch Song'],
  grookey: ['High Horsepower', 'Drain Punch', 'Grassy Glide', 'Clangorous Soul'],
  scorbunny: ['High Jump Kick', 'Triple Axel', 'Extreme Speed', 'Victory Dance'],
  sobble: ['Aeroblast', 'Frost Breath', 'Nasty Plot', 'Astral Barrage'],
  sprigatito: ['Fire Lash', 'Play Rough', 'Sucker Punch', 'Triple Axel'],
  fuecoco: ['Slack Off', 'Earth Power', 'Alluring Voice', 'Overdrive'],
  quaxly: ['Power Trip', 'Roost', 'Triple Axel', 'Dragon Dance'],
  pikachu: ['Extreme Speed', 'Surf', 'Freeze-Dry', 'Rising Voltage'],
  eevee: ['Wish', 'Moonblast', 'Aura Sphere', 'Boomburst'],
  riolu: ['Meteor Mash', 'Bullet Punch', 'Thunderous Kick', 'Extreme Speed'],
  ralts: ['Moonblast', 'Aura Sphere', 'Psyshock', 'Quiver Dance'],
  rookidee: ['Roost', 'Body Press', 'Iron Head', 'Behemoth Bash'],
  gible: ['Iron Head', 'Icicle Spear', 'Dragon Dance', 'Headlong Rush'],
  dreepy: ['Shadow Claw', 'Poltergeist', 'Dragon Dance', 'Astral Barrage'],
  frigibax: ['Icicle Spear', 'Earthquake', 'Iron Head', 'Glacial Lance'],
  charcadet: ['Sacred Sword', 'Shadow Sneak', 'Swords Dance', 'Bitter Blade'],
};

const TYPE_COMMON_EGG_MOVES: Record<string, string[]> = {
  Normal: ['Body Slam', 'Extreme Speed', 'Swords Dance'],
  Fire: ['Flamethrower', 'Bitter Blade', 'Torch Song'],
  Water: ['Liquidation', 'Scald', 'Flip Turn'],
  Electric: ['Thunderbolt', 'Volt Switch', 'Wild Charge'],
  Grass: ['Energy Ball', 'Horn Leech', 'Sleep Powder'],
  Ice: ['Ice Beam', 'Icicle Crash', 'Freeze-Dry'],
  Fighting: ['Drain Punch', 'Close Combat', 'Aura Sphere'],
  Poison: ['Sludge Bomb', 'Poison Jab', 'Toxic Spikes'],
  Ground: ['Earthquake', 'Earth Power', 'Headlong Rush'],
  Flying: ['Hurricane', 'Brave Bird', 'Roost'],
  Psychic: ['Psychic', 'Calm Mind', 'Expanding Force'],
  Bug: ['First Impression', 'U-turn', 'Quiver Dance'],
  Rock: ['Stone Edge', 'Power Gem', 'Stealth Rock'],
  Ghost: ['Shadow Ball', 'Poltergeist', 'Nasty Plot'],
  Dragon: ['Dragon Pulse', 'Glaive Rush', 'Dragon Dance'],
  Dark: ['Knock Off', 'Sucker Punch', 'Ceaseless Edge'],
  Steel: ['Flash Cannon', 'Iron Head', 'Tachyon Cutter'],
  Fairy: ['Moonblast', 'Play Rough', 'Calm Mind'],
};

const RARE_ACE_MOVES_PHYSICAL = ['Victory Dance', 'Dragon Dance', 'Triple Axel', 'Precipice Blades', 'Glacial Lance'];
const RARE_ACE_MOVES_SPECIAL = ['Quiver Dance', 'Shell Smash', 'Tail Glow', 'Astral Barrage', 'Eruption'];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 获取任一初始宝可梦的 4 个专属蛋招式（保证 100% 存在于 @pkmn/dex 标准库中）
 */
export function getSpeciesEggMoves(speciesNameOrId: string): string[] {
  const id = toID(speciesNameOrId);
  const sp = Dex.species.get(id);
  const baseId = toID(sp.baseSpecies || id);

  if (CURATED_EGG_MOVES[baseId]) {
    return CURATED_EGG_MOVES[baseId].filter((m) => Dex.moves.get(m).exists);
  }

  const h = hashString(baseId);
  const t1 = sp.types?.[0] || 'Normal';
  const t2 = sp.types?.[1] || (t1 === 'Normal' ? 'Fighting' : 'Normal');
  const pool = [
    ...(TYPE_COMMON_EGG_MOVES[t1] || TYPE_COMMON_EGG_MOVES.Normal),
    ...(TYPE_COMMON_EGG_MOVES[t2] || TYPE_COMMON_EGG_MOVES.Normal),
    'Earth Power',
    'Aura Sphere',
    'Ice Beam',
    'Knock Off',
  ];

  const picked: string[] = [];
  for (let i = 0; i < pool.length && picked.length < 3; i++) {
    const cand = pool[(h + i * 3) % pool.length];
    if (!picked.includes(cand) && Dex.moves.get(cand).exists) {
      picked.push(cand);
    }
  }

  const isPhys = (sp.baseStats?.atk || 60) >= (sp.baseStats?.spa || 60);
  const rarePool = isPhys ? RARE_ACE_MOVES_PHYSICAL : RARE_ACE_MOVES_SPECIAL;
  const rareMove = rarePool[h % rarePool.length];
  if (!picked.includes(rareMove)) {
    picked.push(rareMove);
  }
  return picked.slice(0, 4);
}

export const EGG_TIER_WAVES: Record<EggTier, number> = {
  common: 6,
  rare: 12,
  epic: 22,
  legendary: 35,
};

export const EGG_TIER_META: Record<EggTier, { zh: string; badgeColor: string; emoji: string }> = {
  common: { zh: '普通宝可梦蛋', badgeColor: '#6ea8fe', emoji: '🥚' },
  rare: { zh: '稀有纹章彩蛋', badgeColor: '#4ecdc4', emoji: '🪺' },
  epic: { zh: '史诗星辉彩蛋', badgeColor: '#c084fc', emoji: '🔮' },
  legendary: { zh: '传说神兽金蛋', badgeColor: '#fbbf24', emoji: '👑' },
};

/**
 * 糖果消耗规则：减费第1档 8 颗、减费第2档 18 颗、觉醒满个体与再生被动 12 颗、定向兑换专属彩蛋 10 颗
 */
export function getCandyActionCosts(speciesId: string): {
  reduceCostNext: number | null;
  awakenCost: number | null;
  buySpeciesEggCost: number;
} {
  const id = toID(speciesId);
  const db = getRogueDexDatabase();
  const baseCost = db.species[id]?.cost || 3;
  const upg = SaveStorage.getStarterUpgrade(id);

  const canReduceFurther = upg.costReduction < 2 && baseCost - upg.costReduction > 1;
  const reduceCostNext = canReduceFurther ? (upg.costReduction === 0 ? 8 : 18) : null;
  const awakenCost = upg.awakened ? null : 12;

  return {
    reduceCostNext,
    awakenCost,
    buySpeciesEggCost: 10,
  };
}

export const EggGachaSystem = {
  /**
   * 消耗蛋券在指定 UP 扭蛋机中抽取彩蛋并放入孵蛋槽
   */
  pullVoucher(machine: GachaMachineType, voucher: VoucherTier): {
    ok: boolean;
    message: string;
    pulledEggs: IncubatingEgg[];
  } {
    const meta = SaveStorage.getMeta();
    if ((meta.vouchers[voucher] || 0) <= 0) {
      return { ok: false, message: '对应品质的蛋券不足！可通过击败道馆主、宿敌与10层Boss获取。', pulledEggs: [] };
    }

    const count = voucher === 'premium' ? 10 : voucher === 'plus' ? 5 : 1;
    meta.vouchers[voucher] -= 1;

    const pulledEggs: IncubatingEgg[] = [];
    for (let i = 0; i < count; i++) {
      let tier = this.rollEggTier(machine);
      // 五连券最后一发保底 Rare+，十连黄金券最后一发保底 Epic+！
      if (voucher === 'plus' && i === count - 1 && tier === 'common') {
        tier = 'rare';
      }
      if (voucher === 'premium' && i === count - 1 && (tier === 'common' || tier === 'rare')) {
        tier = 'epic';
      }

      const egg: IncubatingEgg = {
        id: `egg_${uid()}`,
        tier,
        machine,
        wavesRemaining: EGG_TIER_WAVES[tier],
        totalWaves: EGG_TIER_WAVES[tier],
        createdAt: new Date().toISOString(),
      };
      meta.eggs.push(egg);
      pulledEggs.push(egg);
    }

    SaveStorage.saveMeta(meta);
    return {
      ok: true,
      message: `成功投入蛋券，获得了 ${pulledEggs.length} 枚宝可梦彩蛋！`,
      pulledEggs,
    };
  },

  /**
   * 消耗糖果为指定初始宝可梦升级（减费 / 觉醒被动 / 兑换定向高闪光彩蛋）
   */
  spendStarterCandies(
    speciesId: string,
    action: 'reduce-cost' | 'awaken' | 'buy-egg',
  ): { ok: boolean; message: string } {
    const id = toID(speciesId);
    const meta = SaveStorage.getMeta();
    const curCandies = meta.starterCandies[id] || 0;
    const upg = meta.starterUpgrades[id] || getDefaultUpgradeRecord();
    const costs = getCandyActionCosts(id);

    if (action === 'reduce-cost') {
      if (costs.reduceCostNext === null) {
        return { ok: false, message: '该宝可梦已达最低费用下限（1费或已减2费）！' };
      }
      if (curCandies < costs.reduceCostNext) {
        return { ok: false, message: `糖果不足（需要 🍬${costs.reduceCostNext}）` };
      }
      meta.starterCandies[id] = curCandies - costs.reduceCostNext;
      upg.costReduction += 1;
      meta.starterUpgrades[id] = upg;
      SaveStorage.saveMeta(meta);
      return { ok: true, message: '✨ 永久减费成功！出战预算需求 -1 费！' };
    }

    if (action === 'awaken') {
      if (costs.awakenCost === null) {
        return { ok: false, message: '该宝可梦已完成潜能觉醒！' };
      }
      if (curCandies < costs.awakenCost) {
        return { ok: false, message: `糖果不足（需要 🍬${costs.awakenCost}）` };
      }
      meta.starterCandies[id] = curCandies - costs.awakenCost;
      upg.awakened = true;
      meta.starterUpgrades[id] = upg;
      SaveStorage.saveMeta(meta);
      return { ok: true, message: '🔥 潜能觉醒！该初始宠永久享受 6V 满个体与战后再生被动！' };
    }

    // buy-egg：定向彩蛋立即进入孵化槽且仅需 4 波破壳
    if (curCandies < costs.buySpeciesEggCost) {
      return { ok: false, message: `糖果不足（需要 🍬${costs.buySpeciesEggCost}）` };
    }
    meta.starterCandies[id] = curCandies - costs.buySpeciesEggCost;
    meta.eggs.push({
      id: `egg_${uid()}`,
      tier: 'rare',
      machine: 'shiny',
      targetSpeciesId: id,
      wavesRemaining: 4,
      totalWaves: 4,
      createdAt: new Date().toISOString(),
    });
    SaveStorage.saveMeta(meta);
    return { ok: true, message: '🥚 已兑换专属高闪率定向彩蛋（推进 4 波即可破壳）！' };
  },

  toggleStarterShinyPreference(speciesId: string): boolean {
    const id = toID(speciesId);
    const meta = SaveStorage.getMeta();
    const upg = meta.starterUpgrades[id] || getDefaultUpgradeRecord();
    if (!upg.shinyUnlocked) return false;
    upg.useShiny = !upg.useShiny;
    meta.starterUpgrades[id] = upg;
    SaveStorage.saveMeta(meta);
    return upg.useShiny;
  },

  /**
   * 每通关 1 波爬塔自动推进所有孵化槽进度，并返回本波自然破壳的全部彩蛋结果
   */
  tickEggsOnWaveClear(wavesProgressed = 1): HatchedEggResult[] {
    const meta = SaveStorage.getMeta();
    if (meta.eggs.length === 0) return [];

    const ready: IncubatingEgg[] = [];
    const remaining: IncubatingEgg[] = [];

    for (const egg of meta.eggs) {
      egg.wavesRemaining = Math.max(0, egg.wavesRemaining - wavesProgressed);
      if (egg.wavesRemaining <= 0) {
        ready.push(egg);
      } else {
        remaining.push(egg);
      }
    }

    if (ready.length === 0) {
      SaveStorage.saveMeta(meta);
      return [];
    }

    meta.eggs = remaining;
    SaveStorage.saveMeta(meta);

    return ready.map((egg) => this.resolveEggHatch(egg));
  },

  /**
   * 在孵蛋工坊消耗 1 张普通蛋券立即加速全部彩蛋 -6 波并孵化已满进度的彩蛋
   */
  rushIncubationWithVoucher(): {
    ok: boolean;
    message: string;
    hatched: HatchedEggResult[];
  } {
    const meta = SaveStorage.getMeta();
    if (meta.eggs.length === 0) {
      return { ok: false, message: '当前孵化槽中没有待孵化的彩蛋', hatched: [] };
    }
    if (meta.vouchers.common <= 0) {
      return { ok: false, message: '需要 1 张普通单抽蛋券来注入温箱能量加速！', hatched: [] };
    }
    meta.vouchers.common -= 1;
    SaveStorage.saveMeta(meta);

    const hatched = this.tickEggsOnWaveClear(6);
    return {
      ok: true,
      message:
        hatched.length > 0
          ? `🎉 温箱加速完成，${hatched.length} 枚彩蛋破壳孵化！`
          : '🔥 所有彩蛋剩余孵化波数已减少 6 波！',
      hatched,
    };
  },

  rollEggTier(machine: GachaMachineType): EggTier {
    const r = Math.random() * 100;
    const legChance = machine === 'legendary' ? 4.0 : 1.5;
    const epicChance = machine === 'legendary' ? 14.0 : 9.5;
    const rareChance = 32.0;

    if (r < legChance) return 'legendary';
    if (r < legChance + epicChance) return 'epic';
    if (r < legChance + epicChance + rareChance) return 'rare';
    return 'common';
  },

  resolveEggHatch(egg: IncubatingEgg): HatchedEggResult {
    const db = getRogueDexDatabase();
    let speciesId = egg.targetSpeciesId || '';

    if (!speciesId || !db.species[speciesId]) {
      const candidates = Object.entries(db.species)
        .filter(([, entry]) => entry.starter)
        .filter(([, entry]) => {
          if (egg.tier === 'legendary') return entry.cost >= 8;
          if (egg.tier === 'epic') return entry.cost >= 6 && entry.cost <= 7;
          if (egg.tier === 'rare') return entry.cost >= 4 && entry.cost <= 5;
          return entry.cost <= 3;
        })
        .map(([id]) => id);

      const fallback = Object.entries(db.species)
        .filter(([, e]) => e.starter)
        .map(([id]) => id);
      const pool = candidates.length > 0 ? candidates : fallback;
      speciesId = pool[Math.floor(Math.random() * pool.length)] || 'charmander';
    }

    const shinyRate = egg.machine === 'shiny' || egg.targetSpeciesId ? 1 / 12 : 1 / 48;
    const shiny = Math.random() < shinyRate;

    const allEggMoves = getSpeciesEggMoves(speciesId);
    const upg = SaveStorage.getStarterUpgrade(speciesId);
    const unlearned = allEggMoves.filter((m) => !upg.unlockedEggMoves.includes(m));

    let chosenMove: string | undefined;
    if (unlearned.length > 0) {
      const rareIdx = allEggMoves.length - 1;
      const rareMove = allEggMoves[rareIdx];
      const rareRoll = egg.machine === 'move' ? 0.55 : 0.22;
      if (unlearned.includes(rareMove) && Math.random() < rareRoll) {
        chosenMove = rareMove;
      } else {
        chosenMove = unlearned[Math.floor(Math.random() * unlearned.length)];
      }
    } else {
      chosenMove = allEggMoves[0];
    }

    const candyGained = shiny ? 8 : egg.tier === 'legendary' ? 5 : egg.tier === 'epic' ? 4 : 2;
    const unlockRes = SaveStorage.unlockStarterAndCandy(speciesId, candyGained, {
      shiny,
      eggMove: chosenMove,
    });

    const meta = SaveStorage.getMeta();
    meta.totalEggsHatched = (meta.totalEggsHatched || 0) + 1;
    SaveStorage.saveMeta(meta);

    return {
      eggTier: egg.tier,
      speciesId,
      shiny,
      isNewUnlock: unlockRes.isNewUnlock,
      candyGained,
      newEggMove: unlockRes.newEggMove,
    };
  },
};
