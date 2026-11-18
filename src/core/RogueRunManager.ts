import { Dex, toID, type PokemonSet } from '@pkmn/sim';
import {
  BIOMES,
  BIOME_TRANSITIONS,
  ENDGAME_BIOME,
  getWaveLevelCap,
  type BiomeConfig,
} from '../config/constants';
import {
  CLASSIC_ELITE_GAUNTLET,
  GYM_LEADERS_BY_BIOME,
  RIVAL_PROFILE,
  TRAINER_PROFILES,
  type TrainerProfile,
} from '../config/presets';
import {
  calcBattleExpGain,
  getItemZh,
  getMoveZh,
  getNewLevelUpMoves,
  getRogueDexDatabase,
  getSpeciesMeta,
  getSpeciesZh,
  getStartingMovesForLevel,
  getTotalExpForLevel,
} from '../data/dexRegistry';
import { EggGachaSystem } from './EggGachaSystem';
import {
  SaveStorage,
  type ActiveWaveBuff,
  type HatchedEggResult,
  type RogueGameMode,
  type RogueMemberState,
  type RogueRunSave,
  type VoucherTier,
} from './SaveStorage';

export type BallTier = 'pb' | 'gb' | 'ub' | 'mb';

export interface ShopBuyItem {
  id: string;
  zhName: string;
  desc: string;
  iconSlug: string;
  cost: number;
  targetParty: boolean;
}

export interface RewardDraftItem {
  uid: string;
  id: string;
  zhName: string;
  desc: string;
  tier: BallTier;
  iconSlug: string;
  kind:
    | 'balls'
    | 'x-buff'
    | 'lure'
    | 'relic'
    | 'held-item'
    | 'tm'
    | 'tera-shard'
    | 'evo-item'
    | 'mint'
    | 'voucher';
  payload: Record<string, string | number>;
  needsTargetMember: boolean;
}

export interface WaveEncounterSpec {
  wave: number;
  biome: BiomeConfig;
  isDoubles: boolean;
  kind: 'wild' | 'trainer' | 'rival' | 'gym' | 'elite' | 'champion' | 'boss' | 'final-boss';
  titleZh: string;
  trainer?: TrainerProfile;
  enemyTeam: PokemonSet[];
  bossShields: number;
  canCatch: boolean;
}

export interface PendingMoveLearn {
  memberUid: string;
  speciesZh: string;
  newMoveId: string;
  newMoveZh: string;
}

export interface WaveVictorySummary {
  moneyGained: number;
  expLogs: string[];
  evolutions: Array<{ memberUid: string; fromSpecies: string; toSpecies: string; shiny: boolean }>;
  pendingMoveLearns: PendingMoveLearn[];
  biomeCleared: boolean;
  nextBiomeZh?: string;
  biomeChoices?: BiomeConfig[];
  hasTownMap?: boolean;
  hatchedEggs: HatchedEggResult[];
  voucherDropped?: { tier: VoucherTier; labelZh: string };
  classicCleared?: boolean;
}

const CLASSIC_RIVAL_WAVES = new Set([8, 25, 55, 95, 145, 195]);
const CLASSIC_GYM_WAVES = new Set([20, 50, 80, 110, 140, 170]);

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getBiomeById(biomeId: string): BiomeConfig {
  if (biomeId === ENDGAME_BIOME.id) return ENDGAME_BIOME;
  return BIOMES.find((b) => b.id === biomeId) || BIOMES[0];
}

function estimateMaxHp(speciesName: string, level: number, ivHp = 24, evHp = 0): number {
  const sp = Dex.species.get(speciesName);
  if (sp.id === 'shedinja') return 1;
  const base = sp.baseStats?.hp || 65;
  return Math.floor(((2 * base + ivHp + Math.floor(evHp / 4)) * level) / 100) + level + 10;
}

export function createRogueMember(
  speciesNameOrId: string,
  level = 5,
  opts?: { forceShiny?: boolean; applyStarterMastery?: boolean },
): RogueMemberState {
  const sp = Dex.species.get(speciesNameOrId);
  const species = sp.exists ? sp.name : 'Charmander';
  const baseId = toID(sp.baseSpecies || species);
  const meta = getSpeciesMeta(species);
  const upg = opts?.applyStarterMastery ? SaveStorage.getStarterUpgrade(baseId) : null;

  const baseMoves = getStartingMovesForLevel(species, level);
  const eggMoves = (upg?.unlockedEggMoves || []).filter((m) => Dex.moves.get(m).exists);

  // 将已解锁蛋招式优先编入初始4招，剩余空位补齐升级本系招式
  const mergedMoves: string[] = [];
  for (const em of eggMoves) {
    if (mergedMoves.length < 4 && !mergedMoves.map(toID).includes(toID(em))) {
      mergedMoves.push(em);
    }
  }
  for (const bm of baseMoves) {
    if (mergedMoves.length < 4 && !mergedMoves.map(toID).includes(toID(bm))) {
      mergedMoves.push(bm);
    }
  }
  if (mergedMoves.length === 0) mergedMoves.push('Tackle');

  const awakened = Boolean(upg?.awakened);
  const isPhys = (sp.baseStats?.atk || 60) >= (sp.baseStats?.spa || 60);
  const natures = ['Hardy', 'Adamant', 'Jolly', 'Modest', 'Timid', 'Bold', 'Calm'];
  const nature = awakened
    ? (sp.baseStats?.spe || 60) >= 85
      ? isPhys
        ? 'Jolly'
        : 'Timid'
      : isPhys
        ? 'Adamant'
        : 'Modest'
    : natures[Math.floor(Math.random() * natures.length)];

  const shiny =
    opts?.forceShiny ??
    (upg?.shinyUnlocked && upg.useShiny ? true : Math.random() < 1 / 64);

  const ivVal = awakened ? 31 : 24;
  const maxhp = estimateMaxHp(species, level, ivVal, 0);

  const movePp: Record<string, number> = {};
  for (const m of mergedMoves) {
    const dm = Dex.moves.get(m);
    movePp[dm.id] = dm.pp ? Math.floor(dm.pp * 1.0) : 15;
  }

  const set: PokemonSet = {
    name: species,
    species,
    item: '',
    ability: sp.abilities?.[0] || 'Blaze',
    moves: mergedMoves,
    nature,
    gender: sp.gender || (Math.random() < 0.5 ? 'M' : 'F'),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: ivVal, atk: ivVal, def: ivVal, spa: ivVal, spd: ivVal, spe: ivVal },
    level,
    shiny,
    teraType: sp.types?.[0] || 'Normal',
  };

  return {
    uid: uid(),
    set,
    exp: getTotalExpForLevel(meta?.growthRate || 2, level),
    hp: maxhp,
    maxhp,
    fainted: false,
    status: '',
    movePp,
    boostStacks: {},
    awakened,
  };
}

/**
 * PokéRogue 纯正肉鸽刷塔核心状态机 (v2)：
 * 支持 经典200层(宿敌/道馆主/天王冠军/200层无极汰那) 与 无尽刷塔 双模式、群系拓扑分支、诱饵野生2v2双打、锁品质与蛋券孵蛋闭环
 */
export class RogueRunManager {
  private run: RogueRunSave | null = null;

  constructor() {
    this.run = SaveStorage.getRogueRun();
  }

  hasSavedRun(): boolean {
    return this.run !== null && this.run.party.some((m) => !m.fainted);
  }

  getRun(): RogueRunSave | null {
    return this.run;
  }

  getBudgetLimit(mode: RogueGameMode): number {
    return mode === 'endless' ? 15 : 10;
  }

  /**
   * 计算宝可梦实际开局费用（基于糖果永久减费养成，最低 1 费）
   */
  getEffectiveStarterCost(speciesId: string): number {
    const id = toID(speciesId);
    const meta = getSpeciesMeta(id);
    const baseCost = meta?.cost || 3;
    const upg = SaveStorage.getStarterUpgrade(id);
    return Math.max(1, baseCost - (upg.costReduction || 0));
  }

  rollQuickStarterTrio(): string[] {
    const firePool = ['charmander', 'cyndaquil', 'torchic', 'chimchar', 'fuecoco', 'litten', 'scorbunny', 'charcadet'];
    const waterPool = ['squirtle', 'totodile', 'mudkip', 'piplup', 'froakie', 'oshawott', 'quaxly', 'sobble'];
    const grassOrAcePool = ['bulbasaur', 'treecko', 'turtwig', 'rowlet', 'sprigatito', 'riolu', 'ralts', 'gible'];
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return [pick(grassOrAcePool), pick(firePool), pick(waterPool)];
  }

  startNewRun(starterSpeciesIds: string[], mode: RogueGameMode = 'classic'): RogueRunSave {
    const chosen = starterSpeciesIds.slice(0, 6);
    const party = chosen.map((id) =>
      createRogueMember(id, 5, { applyStarterMastery: true }),
    );

    const meta = SaveStorage.getMeta();
    meta.totalRogueRuns += 1;
    SaveStorage.saveMeta(meta);

    this.run = {
      version: 2,
      mode,
      wave: 1,
      biomeId: 'plains',
      biomeIndex: 0,
      money: mode === 'endless' ? 1500 : 1000,
      balls: { pb: 5, gb: mode === 'endless' ? 2 : 1, ub: 0, mb: 0 },
      relics: {
        expShare: 1,
        luckyEgg: 0,
        expCharm: 0,
        amuletCoin: 0,
        healingCharm: 0,
        shinyCharm: mode === 'endless' ? 1 : 0,
        townMap: 0,
        lockCapsule: 0,
        teraOrb: 0,
      },
      lureWavesLeft: 0,
      rarityLocked: false,
      waveBuffs: [],
      party,
      inShopPhase: false,
      rerollCount: 0,
      updatedAt: new Date().toISOString(),
    };
    SaveStorage.saveRogueRun(this.run);
    return this.run;
  }

  getCurrentBiome(): BiomeConfig {
    if (!this.run) return BIOMES[0];
    if (this.run.mode === 'classic' && this.run.wave >= 191) {
      return ENDGAME_BIOME;
    }
    return getBiomeById(this.run.biomeId || BIOMES[this.run.biomeIndex % BIOMES.length].id);
  }

  /**
   * 队伍闪光幸运值（每只存活闪光宝可梦 +1，每层闪光护符额外 +1）
   */
  getPartyLuckPoints(): number {
    if (!this.run) return 0;
    const shinyMons = this.run.party.filter((m) => !m.fainted && m.set.shiny).length;
    return shinyMons + this.run.relics.shinyCharm;
  }

  getPartyLuckGrade(): string {
    const pts = this.getPartyLuckPoints();
    if (pts >= 5) return 'SSS';
    if (pts === 4) return 'SS';
    if (pts === 3) return 'S';
    if (pts === 2) return 'A';
    if (pts === 1) return 'B+';
    return 'C';
  }

  getStartingBoostMap(): Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>> {
    const out: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>> = {};
    if (!this.run) return out;
    for (const b of this.run.waveBuffs) {
      if (b.wavesLeft > 0) {
        out[b.stat] = Math.min(6, (out[b.stat] || 0) + b.stages);
      }
    }
    return out;
  }

  toggleRarityLock(): { ok: boolean; locked: boolean; message: string } {
    if (!this.run) return { ok: false, locked: false, message: '无存档' };
    if (this.run.relics.lockCapsule <= 0) {
      return {
        ok: false,
        locked: false,
        message: '尚未获得【锁定胶囊】圣物，无法锁定战利品球品质！',
      };
    }
    this.run.rarityLocked = !this.run.rarityLocked;
    SaveStorage.saveRogueRun(this.run);
    return {
      ok: true,
      locked: this.run.rarityLocked,
      message: this.run.rarityLocked
        ? '🔒 已锁定当前三选一精灵球品质（刷新收费翻倍但绝不掉档）'
        : '🔓 已解除品质锁定',
    };
  }

  selectNextBiome(biomeId: string): BiomeConfig {
    if (!this.run) return BIOMES[0];
    const picked = getBiomeById(biomeId);
    this.run.biomeId = picked.id;
    const idx = BIOMES.findIndex((b) => b.id === picked.id);
    if (idx >= 0) this.run.biomeIndex = idx;
    this.run.pendingBiomeChoices = undefined;
    SaveStorage.saveRogueRun(this.run);
    return picked;
  }

  /**
   * 生成当前波次的遭遇（涵盖经典200层宿敌/道馆主/天王冠军/终局无极汰那 与 无尽里程碑Boss/诱饵野生2v2双打）
   */
  generateCurrentWaveEncounter(): WaveEncounterSpec {
    if (!this.run) {
      this.startNewRun(['charmander'], 'classic');
    }
    const run = this.run!;
    const wave = run.wave;
    const biome = this.getCurrentBiome();
    const cap = getWaveLevelCap(wave);
    const waveInChapter = ((wave - 1) % 10) + 1;

    const prevCap = wave <= 10 ? 2 : getWaveLevelCap(wave - 10);
    const progress = waveInChapter / 10;
    const baseEnemyLv = Math.max(2, Math.round(prevCap + (cap - prevCap) * progress * 0.92));

    // =====================================================================
    // A. 经典模式专属剧情里程碑节点 (宿敌 / 道馆主 / 四天王冠军 / 200层无极汰那)
    // =====================================================================
    if (run.mode === 'classic') {
      // 1. 第 200 波：经典模式终局灭世 Boss 无极汰那（5 段霸主护盾！）
      if (wave === 200) {
        const eternatus = this.createEnemyPokemonSet('Eternatus', 200, true);
        eternatus.moves = ['Dynamax Cannon', 'Sludge Wave', 'Flamethrower', 'Recover'];
        eternatus.item = 'Black Sludge';
        eternatus.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
        eternatus.evs = { hp: 252, atk: 0, def: 120, spa: 252, spd: 120, spe: 120 };
        return {
          wave,
          biome: ENDGAME_BIOME,
          isDoubles: false,
          kind: 'final-boss',
          titleZh: '第 200 波 · 终焉灭世霸主 无极汰那',
          enemyTeam: [eternatus],
          bossShields: 5,
          canCatch: false,
        };
      }

      // 2. 第 8 / 25 / 55 / 95 / 145 / 195 波：宿命劲敌阶梯拦路战！
      if (CLASSIC_RIVAL_WAVES.has(wave)) {
        const rivalTeam = this.buildClassicRivalTeam(wave, baseEnemyLv, cap);
        const shields = wave >= 195 ? 3 : wave >= 145 ? 2 : 0;
        return {
          wave,
          biome,
          isDoubles: false,
          kind: 'rival',
          titleZh: `第 ${wave} 波 · ${RIVAL_PROFILE.titleZh} ${RIVAL_PROFILE.zhName}`,
          trainer: RIVAL_PROFILE,
          enemyTeam: rivalTeam,
          bossShields: shields,
          canCatch: false,
        };
      }

      // 3. 第 182 / 184 / 186 / 188 / 190 波：联盟四天王与巅峰冠军连战！
      if (CLASSIC_ELITE_GAUNTLET[wave]) {
        const eliteTrainer = CLASSIC_ELITE_GAUNTLET[wave];
        const teamSize = wave === 190 ? 6 : 5;
        const team = this.buildTrainerSpecialtyTeam(eliteTrainer, biome, wave, Math.max(baseEnemyLv + 2, cap - 2), teamSize);
        return {
          wave,
          biome,
          isDoubles: false,
          kind: 'champion',
          titleZh: `第 ${wave} 波 · ${eliteTrainer.titleZh} ${eliteTrainer.zhName}`,
          trainer: eliteTrainer,
          enemyTeam: team,
          bossShields: wave === 190 ? 2 : 0,
          canCatch: false,
        };
      }

      // 4. 第 20 / 50 / 80 / 110 / 140 / 170 波：生态群系道馆主镇守战！
      if (CLASSIC_GYM_WAVES.has(wave)) {
        const gymLeader = GYM_LEADERS_BY_BIOME[biome.id] || GYM_LEADERS_BY_BIOME.plains;
        const teamSize = Math.min(5, 2 + Math.floor(wave / 35));
        const team = this.buildTrainerSpecialtyTeam(gymLeader, biome, wave, Math.max(baseEnemyLv + 1, cap - 1), teamSize);
        return {
          wave,
          biome,
          isDoubles: false,
          kind: 'gym',
          titleZh: `第 ${wave} 波 · ${gymLeader.titleZh} ${gymLeader.zhName}`,
          trainer: gymLeader,
          enemyTeam: team,
          bossShields: 0,
          canCatch: false,
        };
      }
    }

    // =====================================================================
    // B. 通用 / 无尽爬塔 10 倍数波：多段护盾群系霸主 Boss（破盾可收服！）
    // =====================================================================
    if (wave % 10 === 0) {
      const isParadoxMilestone = run.mode === 'endless' && wave % 50 === 0;
      const paradoxPool = ['Roaring Moon', 'Iron Valiant', 'Flutter Mane', 'Miraidon', 'Koraidon', 'Rayquaza', 'Mewtwo'];
      const bossMon = isParadoxMilestone
        ? paradoxPool[(wave / 50 - 1) % paradoxPool.length]
        : this.pickBiomePokemon(biome, wave, true);
      const bossLv = Math.max(baseEnemyLv + 2, cap);
      const shinyChance = (1 + run.relics.shinyCharm * 3) / 96;
      const bossSet = this.createEnemyPokemonSet(bossMon, bossLv, true, Math.random() < shinyChance);
      const shields = wave >= 100 ? 4 : wave >= 30 ? 3 : 2;
      return {
        wave,
        biome,
        isDoubles: false,
        kind: 'boss',
        titleZh: `第 ${wave} 波 · ${isParadoxMilestone ? '无尽次元霸主' : '群系霸主'} ${getSpeciesZh(bossMon)}`,
        enemyTeam: [bossSet],
        bossShields: shields,
        canCatch: true,
      };
    }

    // =====================================================================
    // C. 第 5 / 15 / 25... 波（经典模式非宿敌波）：精英训练家或野生头目
    // =====================================================================
    if (wave % 5 === 0 && run.mode === 'classic') {
      const trainer = TRAINER_PROFILES[(Math.floor(wave / 5) - 1) % TRAINER_PROFILES.length];
      const teamCount = Math.min(4, 2 + Math.floor(wave / 25));
      const enemyTeam = this.buildTrainerSpecialtyTeam(trainer, biome, wave, baseEnemyLv, teamCount);
      return {
        wave,
        biome,
        isDoubles: false,
        kind: 'elite',
        titleZh: `第 ${wave} 波 · 精英训练家 ${trainer.zhName}`,
        trainer,
        enemyTeam,
        bossShields: 0,
        canCatch: false,
      };
    }

    // 普通波次偶遇路人训练家（仅经典模式每章第 7 波且非终局深渊）
    if (run.mode === 'classic' && waveInChapter === 7 && wave > 3 && wave < 190) {
      const trainer = TRAINER_PROFILES[wave % TRAINER_PROFILES.length];
      const count = wave >= 27 ? 2 : 1;
      const enemyTeam = Array.from({ length: count }, () =>
        this.createEnemyPokemonSet(this.pickBiomePokemon(biome, wave, false), baseEnemyLv, false),
      );
      return {
        wave,
        biome,
        isDoubles: false,
        kind: 'trainer',
        titleZh: `第 ${wave} 波 · 探险训练家 ${trainer.zhName}`,
        trainer,
        enemyTeam,
        bossShields: 0,
        canCatch: false,
      };
    }

    // =====================================================================
    // D. 野生宝可梦遭遇（支持引虫诱饵触发 PokéRogue 原味野生 2v2 双打刷闪！）
    // =====================================================================
    const alivePlayerCount = run.party.filter((m) => !m.fainted && m.hp > 0).length;
    const doubleChance =
      alivePlayerCount >= 2
        ? run.lureWavesLeft > 0
          ? 0.72
          : run.mode === 'endless' && wave > 10
            ? 0.22
            : 0.08
        : 0;
    const isWildDoubles = Math.random() < doubleChance;

    const shinyChance = (1 + run.relics.shinyCharm * 3) / 128;
    const wildSp1 = this.pickBiomePokemon(biome, wave, false);
    const wildSet1 = this.createEnemyPokemonSet(wildSp1, baseEnemyLv, false, Math.random() < shinyChance);

    if (isWildDoubles) {
      const wildSp2 = this.pickBiomePokemon(biome, wave, false);
      const wildSet2 = this.createEnemyPokemonSet(wildSp2, baseEnemyLv, false, Math.random() < shinyChance);
      return {
        wave,
        biome,
        isDoubles: true,
        kind: 'wild',
        titleZh: `第 ${wave} 波 · 野生双打 ${getSpeciesZh(wildSp1)} & ${getSpeciesZh(wildSp2)}`,
        enemyTeam: [wildSet1, wildSet2],
        bossShields: 0,
        canCatch: true,
      };
    }

    return {
      wave,
      biome,
      isDoubles: false,
      kind: 'wild',
      titleZh: `第 ${wave} 波 · 野生 ${getSpeciesZh(wildSp1)}`,
      enemyTeam: [wildSet1],
      bossShields: 0,
      canCatch: true,
    };
  }

  private buildClassicRivalTeam(wave: number, baseLv: number, cap: number): PokemonSet[] {
    const aceLv = Math.min(cap, baseLv + 2);
    const subLv = Math.max(5, aceLv - 2);

    const fireStage = wave >= 55 ? 'Charizard' : wave >= 25 ? 'Charmeleon' : 'Charmander';
    const birdStage = wave >= 55 ? 'Staraptor' : wave >= 25 ? 'Staravia' : 'Starly';

    const roster: Array<{ sp: string; lv: number }> = [
      { sp: birdStage, lv: subLv },
      { sp: fireStage, lv: aceLv },
    ];
    if (wave >= 25) roster.push({ sp: wave >= 55 ? 'Floatzel' : 'Buizel', lv: subLv });
    if (wave >= 55) roster.push({ sp: 'Roserade', lv: subLv });
    if (wave >= 95) roster.push({ sp: 'Metagross', lv: subLv + 1 });
    if (wave >= 145) {
      // PokéRogue 经典宿敌标志性绿毛神龙裂空座压阵（最后登场享受 Boss 护盾）
      roster.unshift(...roster.splice(0, roster.length));
      roster.push({ sp: 'Rayquaza', lv: aceLv + 1 });
    }

    return roster.map((r, i) =>
      this.createEnemyPokemonSet(r.sp, r.lv, wave >= 25, wave >= 145 && i === roster.length - 1),
    );
  }

  private buildTrainerSpecialtyTeam(
    trainer: TrainerProfile,
    biome: BiomeConfig,
    wave: number,
    aceLv: number,
    count: number,
  ): PokemonSet[] {
    const sigs = trainer.signatureSpecies || [];
    const list: PokemonSet[] = [];
    for (let i = 0; i < count; i++) {
      const isAce = i === count - 1;
      const lv = isAce ? aceLv : Math.max(5, aceLv - 2 + (i % 2));
      let spName = '';
      if (isAce && sigs.length > 0 && wave >= 20) {
        spName = sigs[0];
      } else if (i < sigs.length && wave >= 50) {
        spName = sigs[i];
      } else {
        spName = this.pickBiomePokemon(biome, wave + 5, isAce);
      }
      list.push(this.createEnemyPokemonSet(spName, lv, wave >= 20));
    }
    return list;
  }

  private pickBiomePokemon(biome: BiomeConfig, wave: number, preferStrong: boolean): string {
    const db = getRogueDexDatabase();
    const minBst = preferStrong
      ? wave >= 30
        ? 515
        : 450
      : wave <= 6
        ? 240
        : wave <= 18
          ? 320
          : 410;
    const maxBst = preferStrong
      ? wave >= 40
        ? 680
        : 560
      : wave <= 8
        ? 395
        : wave <= 22
          ? 495
          : 600;

    const candidates: string[] = [];
    for (const id of Object.keys(db.species)) {
      const entry = db.species[id];
      if (entry.legendary && (!preferStrong || wave < 30)) continue;
      const sp = Dex.species.get(id);
      if (!sp.exists || sp.isNonstandard) continue;
      if (sp.bst < minBst || sp.bst > maxBst) continue;
      if (sp.types.some((t) => biome.primaryTypes.includes(t))) {
        candidates.push(sp.name);
      }
    }

    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return preferStrong ? 'Gyarados' : 'Pikachu';
  }

  private createEnemyPokemonSet(
    speciesName: string,
    level: number,
    withItem: boolean,
    shiny = false,
  ): PokemonSet {
    const sp = Dex.species.get(speciesName);
    const moves = getStartingMovesForLevel(speciesName, level);
    const items = ['Sitrus Berry', 'Lum Berry', 'Leftovers', 'Life Orb'];
    return {
      name: sp.name,
      species: sp.name,
      item: withItem ? items[Math.floor(Math.random() * items.length)] : '',
      ability: sp.abilities?.[0] || 'Overgrow',
      moves,
      nature: 'Serious',
      gender: sp.gender || (Math.random() < 0.5 ? 'M' : 'F'),
      evs: { hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 },
      ivs: { hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 },
      level,
      shiny,
      teraType: sp.types?.[0] || 'Normal',
    };
  }

  estimateCatchProbability(
    ball: BallTier,
    speciesName: string,
    hpPercent: number,
    status: string,
    remainingBossShields = 0,
  ): number {
    if (remainingBossShields > 0) return 0;
    if (ball === 'mb') return 100;

    const meta = getSpeciesMeta(speciesName);
    const captureRate = meta?.captureRate || 45;
    const ballMult = ball === 'ub' ? 2.0 : ball === 'gb' ? 1.5 : 1.0;
    const statusMult =
      status === 'slp' || status === 'frz'
        ? 2.5
        : status
          ? 1.5
          : 1.0;
    const hpRatio = Math.max(0.01, Math.min(1, hpPercent / 100));
    const hpFactor = (3 - 2 * hpRatio) / 3;
    const modifiedA = Math.min(255, captureRate * ballMult * hpFactor * statusMult);
    const pct = Math.min(100, Math.max(2, Math.round((modifiedA / 255) * 100)));
    return pct;
  }

  attemptPokeballThrow(
    ball: BallTier,
    enemySet: PokemonSet,
    hpPercent: number,
    status: string,
    remainingBossShields = 0,
  ): { ok: boolean; reason?: string; caught: boolean; shakes: number; catchPct: number } {
    if (!this.run) return { ok: false, reason: '当前不在爬塔对局中', caught: false, shakes: 0, catchPct: 0 };
    if (remainingBossShields > 0) {
      return { ok: false, reason: '霸主护盾尚未击破，精灵球被弹开了！', caught: false, shakes: 0, catchPct: 0 };
    }
    if (this.run.balls[ball] <= 0) {
      return { ok: false, reason: '该种精灵球库存不足！', caught: false, shakes: 0, catchPct: 0 };
    }

    this.run.balls[ball] -= 1;
    const catchPct = this.estimateCatchProbability(ball, enemySet.species, hpPercent, status, 0);
    const roll = Math.random() * 100;
    const caught = ball === 'mb' || roll <= catchPct;
    const shakes = caught ? 3 : Math.max(1, Math.min(3, Math.ceil((roll - catchPct) / 28)));

    if (caught) {
      const baseId = toID(Dex.species.get(enemySet.species).baseSpecies || enemySet.species);
      SaveStorage.unlockStarterAndCandy(baseId, enemySet.shiny ? 6 : 2, {
        shiny: Boolean(enemySet.shiny),
      });
    }
    SaveStorage.saveRogueRun(this.run);
    return { ok: true, caught, shakes, catchPct };
  }

  addCapturedToParty(enemySet: PokemonSet, replaceIndex?: number): RogueMemberState {
    const member = createRogueMember(enemySet.species, enemySet.level || 5, {
      forceShiny: enemySet.shiny,
    });
    member.set.moves = [...enemySet.moves];
    member.set.ability = enemySet.ability;
    member.set.item = enemySet.item || '';

    if (this.run) {
      if (this.run.party.length < 6) {
        this.run.party.push(member);
      } else if (typeof replaceIndex === 'number' && this.run.party[replaceIndex]) {
        this.run.party[replaceIndex] = member;
      }
      SaveStorage.saveRogueRun(this.run);
    }
    return member;
  }

  /**
   * 同步战斗结束后的状态，结算金币、经验、进化、蛋券掉落、彩蛋孵化推进与10层群系分支选择
   */
  completeWaveVictory(
    persistedParty: Array<{
      hp: number;
      maxhp: number;
      fainted: boolean;
      status: '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';
      movePp: Record<string, number>;
    }>,
    encounter: WaveEncounterSpec,
  ): WaveVictorySummary {
    const run = this.run!;
    const cap = getWaveLevelCap(run.wave);

    // 1. 同步战斗损耗 + 治疗护符 & 糖果觉醒再生回复
    for (let i = 0; i < run.party.length; i++) {
      const m = run.party[i];
      const p = persistedParty[i];
      if (!p) continue;
      m.maxhp = p.maxhp;
      m.hp = p.hp;
      m.fainted = p.fainted;
      m.status = p.status;
      m.movePp = { ...m.movePp, ...p.movePp };

      if (!m.fainted) {
        const regenRatio = run.relics.healingCharm * 0.08 + (m.awakened ? 0.1 : 0);
        if (regenRatio > 0) {
          const healAmt = Math.max(1, Math.floor(m.maxhp * regenRatio));
          m.hp = Math.min(m.maxhp, m.hp + healAmt);
        }
      }
    }

    // 2. 递减强化药剂与引虫诱饵剩余波数
    for (const buff of run.waveBuffs) {
      buff.wavesLeft -= 1;
    }
    run.waveBuffs = run.waveBuffs.filter((b) => b.wavesLeft > 0);
    if (run.lureWavesLeft > 0) {
      run.lureWavesLeft -= 1;
    }

    // 3. 金币奖励
    const baseMoney =
      encounter.kind === 'final-boss'
        ? 5000
        : encounter.kind === 'boss' || encounter.kind === 'gym' || encounter.kind === 'champion'
          ? 450 + run.wave * 38
          : encounter.kind === 'rival' || encounter.kind === 'elite'
            ? 280 + run.wave * 26
            : encounter.kind === 'trainer'
              ? 150 + run.wave * 16
              : 70 + run.wave * 10;
    const moneyGained = Math.round(baseMoney * (1 + run.relics.amuletCoin * 0.25));
    run.money += moneyGained;

    // 4. 经验结算与出战糖果积累
    const isTrainer = encounter.kind !== 'wild';
    let totalBaseExp = 0;
    for (const foe of encounter.enemyTeam) {
      totalBaseExp += calcBattleExpGain(
        foe.species,
        foe.level || 5,
        isTrainer,
        run.relics.luckyEgg,
        run.relics.expCharm,
      );
    }

    // 每通过 5 波，存活主力同伴额外积累 +1 专属糖果
    if (run.wave % 5 === 0 && run.party[0]) {
      const leadBaseId = toID(Dex.species.get(run.party[0].set.species).baseSpecies || run.party[0].set.species);
      SaveStorage.unlockStarterAndCandy(leadBaseId, 1);
    }

    const expLogs: string[] = [];
    const pendingMoveLearns: PendingMoveLearn[] = [];
    const evolutions: WaveVictorySummary['evolutions'] = [];
    const shareRatio = Math.min(1.0, run.relics.expShare * 0.35);

    for (let idx = 0; idx < run.party.length; idx++) {
      const m = run.party[idx];
      if (m.fainted) continue;
      const gain = idx === 0 ? totalBaseExp : Math.floor(totalBaseExp * shareRatio);
      if (gain <= 0) continue;

      const oldLv = m.set.level || 5;
      if (oldLv >= cap) {
        expLogs.push(`${getSpeciesZh(m.set.species)} 已达章节上限 Lv.${cap}`);
        continue;
      }

      const meta = getSpeciesMeta(m.set.species);
      const growthId = meta?.growthRate || 2;
      m.exp += gain;

      let newLv = oldLv;
      while (newLv < cap && m.exp >= getTotalExpForLevel(growthId, newLv + 1)) {
        newLv++;
      }

      if (newLv > oldLv) {
        m.set.level = newLv;
        const oldMax = m.maxhp;
        m.maxhp = estimateMaxHp(m.set.species, newLv, m.set.ivs?.hp || 24, m.set.evs?.hp || 0);
        m.hp = Math.min(m.maxhp, m.hp + Math.max(1, m.maxhp - oldMax));
        expLogs.push(`⬆ ${getSpeciesZh(m.set.species)} 升到了 Lv.${newLv}！`);

        const newMoves = getNewLevelUpMoves(m.set.species, oldLv, newLv, m.set.moves);
        for (const mvId of newMoves) {
          if (m.set.moves.length < 4) {
            m.set.moves.push(mvId);
            const dm = Dex.moves.get(mvId);
            m.movePp[dm.id] = dm.pp || 15;
            expLogs.push(`✨ ${getSpeciesZh(m.set.species)} 学会了【${getMoveZh(mvId)}】！`);
          } else {
            pendingMoveLearns.push({
              memberUid: m.uid,
              speciesZh: getSpeciesZh(m.set.species),
              newMoveId: mvId,
              newMoveZh: getMoveZh(mvId),
            });
          }
        }

        const evoRule = meta?.evos.find(
          (e) =>
            (e.trigger === 'level' || e.trigger === 'friendship') &&
            typeof e.level === 'number' &&
            newLv >= e.level,
        );
        if (evoRule) {
          const evoSp = Dex.species.get(evoRule.to);
          if (evoSp.exists) {
            const fromSpecies = m.set.species;
            this.applyMemberEvolution(m, evoSp.name);
            evolutions.push({
              memberUid: m.uid,
              fromSpecies,
              toSpecies: evoSp.name,
              shiny: Boolean(m.set.shiny),
            });
            expLogs.push(`🌟 ${getSpeciesZh(fromSpecies)} 进化成了 <b>${getSpeciesZh(evoSp.name)}</b>！`);
          }
        }
      }
    }

    // 5. 蛋券里程碑掉落结算 (PokéRogue 核心扭蛋驱动力！)
    let voucherDropped: { tier: VoucherTier; labelZh: string } | undefined;
    if (encounter.kind === 'final-boss') {
      SaveStorage.addVoucher('premium', 1);
      voucherDropped = { tier: 'premium', labelZh: '👑 黄金十连蛋券 ×1' };
    } else if (encounter.kind === 'gym' || encounter.kind === 'champion' || (run.mode === 'endless' && run.wave % 50 === 0)) {
      SaveStorage.addVoucher('plus', 1);
      voucherDropped = { tier: 'plus', labelZh: '🎟 精良五连蛋券 ×1' };
    } else if (encounter.kind === 'rival') {
      const vt: VoucherTier = run.wave >= 95 ? 'plus' : 'common';
      SaveStorage.addVoucher(vt, 1);
      voucherDropped = {
        tier: vt,
        labelZh: vt === 'plus' ? '🎟 精良五连蛋券 ×1' : '🎫 普通单抽蛋券 ×1',
      };
    } else if (encounter.kind === 'boss' && run.wave % 20 === 0) {
      SaveStorage.addVoucher('common', 1);
      voucherDropped = { tier: 'common', labelZh: '🎫 普通单抽蛋券 ×1' };
    }

    // 6. 推进孵蛋槽波数并收集破壳彩蛋
    const hatchedEggs = EggGachaSystem.tickEggsOnWaveClear(1);

    // 7. 经典第 200 波终局通关判定！
    const meta = SaveStorage.getMeta();
    if (run.wave > meta.highestRogueWave) meta.highestRogueWave = run.wave;
    if (run.mode === 'classic' && run.wave > meta.highestClassicWave) meta.highestClassicWave = run.wave;
    if (run.mode === 'endless' && run.wave > meta.highestEndlessWave) meta.highestEndlessWave = run.wave;

    if (run.mode === 'classic' && run.wave >= 200) {
      meta.classicClears += 1;
      for (const m of run.party) {
        const baseId = toID(Dex.species.get(m.set.species).baseSpecies || m.set.species);
        if (!meta.ribbonsSpecies.includes(baseId)) {
          meta.ribbonsSpecies.push(baseId);
        }
        meta.starterCandies[baseId] = (meta.starterCandies[baseId] || 0) + 5;
      }
      SaveStorage.saveMeta(meta);
      SaveStorage.clearRogueRun();
      this.run = null;
      return {
        moneyGained,
        expLogs,
        evolutions,
        pendingMoveLearns,
        biomeCleared: true,
        hatchedEggs,
        voucherDropped,
        classicCleared: true,
      };
    }
    SaveStorage.saveMeta(meta);

    // 8. 每 10 波关底通关：全队满状态恢复 + 生态群系路线分支生成！
    let biomeCleared = false;
    let nextBiomeZh: string | undefined;
    let biomeChoices: BiomeConfig[] | undefined;

    if (run.wave % 10 === 0) {
      biomeCleared = true;
      for (const m of run.party) {
        m.fainted = false;
        m.hp = m.maxhp;
        m.status = '';
        for (const mv of m.set.moves) {
          const dm = Dex.moves.get(mv);
          m.movePp[dm.id] = dm.pp || 15;
        }
      }

      if (run.mode === 'classic' && run.wave === 190) {
        run.biomeId = ENDGAME_BIOME.id;
        nextBiomeZh = ENDGAME_BIOME.zhName;
      } else {
        const nextIds = BIOME_TRANSITIONS[run.biomeId] || BIOME_TRANSITIONS.plains;
        const count = run.relics.townMap > 0 ? 3 : 2;
        const pickedIds = nextIds.slice(0, count);
        run.pendingBiomeChoices = pickedIds;
        biomeChoices = pickedIds.map((id) => getBiomeById(id));
        // 先设置默认第1分支，若玩家在路线弹窗主动选其它分支则覆盖
        this.selectNextBiome(pickedIds[0]);
        run.pendingBiomeChoices = pickedIds;
        nextBiomeZh = biomeChoices[0]?.zhName;
      }
    }

    run.inShopPhase = true;
    run.rerollCount = 0;
    run.rarityLocked = false;
    SaveStorage.saveRogueRun(run);

    return {
      moneyGained,
      expLogs,
      evolutions,
      pendingMoveLearns,
      biomeCleared,
      nextBiomeZh,
      biomeChoices,
      hasTownMap: run.relics.townMap > 0,
      hatchedEggs,
      voucherDropped,
    };
  }

  applyMemberEvolution(member: RogueMemberState, targetSpeciesName: string): void {
    const newSp = Dex.species.get(targetSpeciesName);
    if (!newSp.exists) return;
    member.set.species = newSp.name;
    member.set.name = newSp.name;
    member.set.ability = newSp.abilities?.[0] || member.set.ability;
    const oldMax = member.maxhp;
    member.maxhp = estimateMaxHp(newSp.name, member.set.level || 16, member.set.ivs?.hp || 24);
    member.hp = Math.min(member.maxhp, member.hp + Math.max(4, member.maxhp - oldMax));
  }

  replaceMemberMove(memberUid: string, slotIdx: number, newMoveId: string): void {
    if (!this.run) return;
    const m = this.run.party.find((p) => p.uid === memberUid);
    if (!m) return;
    const dm = Dex.moves.get(newMoveId);
    if (!dm.exists) return;
    if (slotIdx >= 0 && slotIdx < m.set.moves.length) {
      m.set.moves[slotIdx] = dm.id;
    } else if (m.set.moves.length < 4) {
      m.set.moves.push(dm.id);
    }
    m.movePp[dm.id] = dm.pp || 15;
    SaveStorage.saveRogueRun(this.run);
  }

  swapLeadMember(partyIndex: number): void {
    if (!this.run || partyIndex <= 0 || partyIndex >= this.run.party.length) return;
    const target = this.run.party[partyIndex];
    if (target.fainted) return;
    const [picked] = this.run.party.splice(partyIndex, 1);
    this.run.party.unshift(picked);
    SaveStorage.saveRogueRun(this.run);
  }

  ensureAliveLead(): void {
    if (!this.run || this.run.party.length === 0) return;
    if (!this.run.party[0].fainted && this.run.party[0].hp > 0) return;
    const aliveIdx = this.run.party.findIndex((m) => !m.fainted && m.hp > 0);
    if (aliveIdx > 0) {
      this.swapLeadMember(aliveIdx);
    }
  }

  handleRunDefeat(): { wave: number; mode: RogueGameMode } {
    const reachedWave = this.run?.wave || 1;
    const mode = this.run?.mode || 'classic';
    const meta = SaveStorage.getMeta();
    if (reachedWave > meta.highestRogueWave) meta.highestRogueWave = reachedWave;
    if (mode === 'classic' && reachedWave > meta.highestClassicWave) meta.highestClassicWave = reachedWave;
    if (mode === 'endless' && reachedWave > meta.highestEndlessWave) meta.highestEndlessWave = reachedWave;
    SaveStorage.saveMeta(meta);
    SaveStorage.clearRogueRun();
    this.run = null;
    return { wave: reachedWave, mode };
  }

  /**
   * PokéRogue 第一轨：生成战后常驻金币补给商店商品
   */
  getShopBuyCatalog(): ShopBuyItem[] {
    const w = this.run?.wave || 1;
    const scale = 1 + Math.floor(w / 10) * 0.35;
    const potionTier = w >= 25
      ? { id: 'hyper-potion', zhName: '厉害伤药', desc: '回复单只宝可梦 120 点 HP', slug: 'hyper-potion', base: 240 }
      : w >= 10
        ? { id: 'super-potion', zhName: '好伤药', desc: '回复单只宝可梦 60 点 HP', slug: 'super-potion', base: 140 }
        : { id: 'potion', zhName: '伤药', desc: '回复单只宝可梦 25 点 HP', slug: 'potion', base: 75 };

    return [
      {
        id: potionTier.id,
        zhName: potionTier.zhName,
        desc: potionTier.desc,
        iconSlug: potionTier.slug,
        cost: Math.round(potionTier.base * scale),
        targetParty: true,
      },
      {
        id: 'revive',
        zhName: '活力碎片',
        desc: '复活濒死同伴并回复 50% HP',
        iconSlug: 'revive',
        cost: Math.round(280 * scale),
        targetParty: true,
      },
      {
        id: 'full-heal',
        zhName: '万灵药',
        desc: '治愈单只宝可梦所有异常状态',
        iconSlug: 'full-heal',
        cost: Math.round(110 * scale),
        targetParty: true,
      },
      {
        id: 'leppa-ether',
        zhName: 'PP 补剂',
        desc: '恢复单只宝可梦全部招式 PP',
        iconSlug: 'max-ether',
        cost: Math.round(160 * scale),
        targetParty: true,
      },
      {
        id: 'lure-buy',
        zhName: '黄金诱饵',
        desc: '接下来 5 波高概率触发野生 2v2 双打（双倍经验与刷闪效率！）',
        iconSlug: 'max-lure',
        cost: Math.round(210 * scale),
        targetParty: false,
      },
      {
        id: 'rare-candy-buy',
        zhName: '神奇糖果',
        desc: '立即提升 1 级（最高可突破当前上限 +1）',
        iconSlug: 'rare-candy',
        cost: Math.round(360 * scale),
        targetParty: true,
      },
    ];
  }

  buyShopItem(itemId: string, memberUid: string): { ok: boolean; message: string } {
    if (!this.run) return { ok: false, message: '无有效存档' };
    const catalog = this.getShopBuyCatalog();
    const item = catalog.find((c) => c.id === itemId);
    if (!item) return { ok: false, message: '未知商品' };
    if (this.run.money < item.cost) return { ok: false, message: '金币不足！' };

    if (itemId === 'lure-buy') {
      this.run.lureWavesLeft += 5;
      this.run.money -= item.cost;
      SaveStorage.saveRogueRun(this.run);
      return { ok: true, message: `✨ 黄金诱饵生效！剩余 ${this.run.lureWavesLeft} 波高概率遭遇野生双打！` };
    }

    const member = this.run.party.find((m) => m.uid === memberUid);
    if (!member) return { ok: false, message: '请先选择目标宝可梦' };

    switch (itemId) {
      case 'potion':
      case 'super-potion':
      case 'hyper-potion': {
        if (member.fainted || member.hp >= member.maxhp) {
          return { ok: false, message: member.fainted ? '请先使用活力碎片复活！' : 'HP 已满，无需治疗' };
        }
        const amt = itemId === 'hyper-potion' ? 120 : itemId === 'super-potion' ? 60 : 25;
        member.hp = Math.min(member.maxhp, member.hp + amt);
        break;
      }
      case 'revive': {
        if (!member.fainted) return { ok: false, message: '该宝可梦未濒死' };
        member.fainted = false;
        member.hp = Math.max(1, Math.floor(member.maxhp * 0.5));
        member.status = '';
        break;
      }
      case 'full-heal': {
        if (!member.status) return { ok: false, message: '当前无异常状态' };
        member.status = '';
        break;
      }
      case 'leppa-ether': {
        for (const mv of member.set.moves) {
          const dm = Dex.moves.get(mv);
          member.movePp[dm.id] = dm.pp || 15;
        }
        break;
      }
      case 'rare-candy-buy': {
        const cap = getWaveLevelCap(this.run.wave) + 1;
        if ((member.set.level || 5) >= cap) {
          return { ok: false, message: '已达糖果强化极限等级' };
        }
        member.set.level = (member.set.level || 5) + 1;
        member.maxhp = estimateMaxHp(member.set.species, member.set.level, member.set.ivs?.hp || 24);
        member.hp = Math.min(member.maxhp, member.hp + 5);
        break;
      }
    }

    this.run.money -= item.cost;
    SaveStorage.saveRogueRun(this.run);
    return { ok: true, message: `已对 ${getSpeciesZh(member.set.species)} 使用【${item.zhName}】！` };
  }

  getRerollCost(): number {
    if (!this.run) return 100;
    const base = 90 + Math.floor(this.run.wave / 5) * 35;
    const lockMult = this.run.rarityLocked ? 2 : 1;
    return Math.round(base * Math.pow(1.65, this.run.rerollCount) * lockMult);
  }

  /**
   * PokéRogue 第二轨：抽取 3 张精灵球品质免费战利品（支持锁定胶囊保品质刷新！）
   */
  rollFreeRewardDraft(
    isReroll = false,
    previousTiers?: BallTier[],
  ): { ok: boolean; reason?: string; items: RewardDraftItem[] } {
    if (!this.run) return { ok: false, reason: '无存档', items: [] };
    if (isReroll) {
      const cost = this.getRerollCost();
      if (this.run.money < cost) {
        return { ok: false, reason: `金币不足（需要 ₽${cost}）`, items: [] };
      }
      this.run.money -= cost;
      this.run.rerollCount += 1;
      SaveStorage.saveRogueRun(this.run);
    }

    const luck = this.getPartyLuckPoints();
    const isBoss = this.run.wave % 10 === 0;
    const isElite = this.run.wave % 5 === 0 || CLASSIC_RIVAL_WAVES.has(this.run.wave);

    const tierRank: Record<BallTier, number> = { pb: 0, gb: 1, ub: 2, mb: 3 };
    const rollTier = (slotIdx: number): BallTier => {
      let rolled: BallTier = 'pb';
      if (!isReroll && slotIdx === 0 && isBoss) {
        rolled = Math.random() < 0.35 + luck * 0.06 ? 'mb' : 'ub';
      } else if (!isReroll && slotIdx === 0 && isElite) {
        rolled = Math.random() < 0.4 + luck * 0.05 ? 'ub' : 'gb';
      } else {
        const r = Math.random() * 100 - luck * 4.5;
        if (r < 4.0) rolled = 'mb';
        else if (r < 20) rolled = 'ub';
        else if (r < 54) rolled = 'gb';
        else rolled = 'pb';
      }

      if (isReroll && this.run?.rarityLocked && previousTiers?.[slotIdx]) {
        const prev = previousTiers[slotIdx];
        // 锁定胶囊不仅不降级，还有小概率向上升档！
        return tierRank[rolled] > tierRank[prev] ? rolled : prev;
      }
      return rolled;
    };

    const items: RewardDraftItem[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < 3; i++) {
      const tier = rollTier(i);
      const pool = this.buildRewardPoolForTier(tier).filter((x) => !usedIds.has(x.id));
      const picked = pool[Math.floor(Math.random() * pool.length)] || this.buildRewardPoolForTier('pb')[0];
      usedIds.add(picked.id);
      items.push({ ...picked, uid: uid() });
    }

    return { ok: true, items };
  }

  private buildRewardPoolForTier(tier: BallTier): Omit<RewardDraftItem, 'uid'>[] {
    const run = this.run;
    const evoNeeds: Array<{ slug: string; zh: string }> = [];
    for (const m of run?.party || []) {
      const meta = getSpeciesMeta(m.set.species);
      for (const evo of meta?.evos || []) {
        if ((evo.trigger === 'item' || evo.trigger === 'linking-cord') && evo.item) {
          evoNeeds.push({ slug: evo.item, zh: getItemZh(evo.item) });
        }
      }
    }

    if (tier === 'mb') {
      const mbList: Omit<RewardDraftItem, 'uid'>[] = [
        {
          id: 'master-ball-pack',
          zhName: '大师球 ×1',
          desc: '必定成功捕获任何已破盾野生宝可梦的究极精灵球',
          tier: 'mb',
          iconSlug: 'master-ball',
          kind: 'balls',
          payload: { ball: 'mb', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'relic-exp-charm-super',
          zhName: '幸运蛋',
          desc: '永久圣物：全队战斗经验获取量额外 +40%（可叠加）',
          tier: 'mb',
          iconSlug: 'lucky-egg',
          kind: 'relic',
          payload: { relic: 'luckyEgg', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'relic-shiny-charm',
          zhName: '闪光护符',
          desc: '永久圣物：大幅提升野生闪光出现率并直接 +1 商店幸运等级！',
          tier: 'mb',
          iconSlug: 'oval-charm',
          kind: 'relic',
          payload: { relic: 'shinyCharm', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'voucher-plus-drop',
          zhName: '精良五连蛋券 ×1',
          desc: '局外永久资产：立即存入扭蛋机，抽取 5 枚彩蛋（保底稀有）！',
          tier: 'mb',
          iconSlug: 'mystery-egg',
          kind: 'voucher',
          payload: { voucher: 'plus', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'held-leftovers',
          zhName: '吃剩的东西',
          desc: '携带物：每回合结束自动回复 1/16 最大 HP',
          tier: 'mb',
          iconSlug: 'leftovers',
          kind: 'held-item',
          payload: { item: 'Leftovers' },
          needsTargetMember: true,
        },
      ];
      if ((run?.relics.lockCapsule || 0) === 0) {
        mbList.unshift({
          id: 'relic-lock-capsule',
          zhName: '锁定胶囊',
          desc: 'PokéRogue 神级圣物：商店刷新时可锁定当前精灵球品质绝不降级！',
          tier: 'mb',
          iconSlug: 'lock-capsule',
          kind: 'relic',
          payload: { relic: 'lockCapsule', count: 1 },
          needsTargetMember: false,
        });
      }
      return mbList;
    }

    if (tier === 'ub') {
      const list: Omit<RewardDraftItem, 'uid'>[] = [
        {
          id: 'ultra-ball-pack',
          zhName: '高级球 ×5',
          desc: '补充 5 颗 2.0× 高捕获率高级球',
          tier: 'ub',
          iconSlug: 'ultra-ball',
          kind: 'balls',
          payload: { ball: 'ub', count: 5 },
          needsTargetMember: false,
        },
        {
          id: 'held-life-orb',
          zhName: '生命宝珠',
          desc: '携带物：所有招式威力提升 1.3×（每次攻击消耗 10% HP）',
          tier: 'ub',
          iconSlug: 'life-orb',
          kind: 'held-item',
          payload: { item: 'Life Orb' },
          needsTargetMember: true,
        },
        {
          id: 'held-focus-sash',
          zhName: '气势披带',
          desc: '携带物：满血时受到致命伤害必定保留 1 点 HP',
          tier: 'ub',
          iconSlug: 'focus-sash',
          kind: 'held-item',
          payload: { item: 'Focus Sash' },
          needsTargetMember: true,
        },
        {
          id: 'relic-amulet-coin',
          zhName: '护符金币',
          desc: '永久圣物：每波结算获得金币永久 +25%（可叠加）',
          tier: 'ub',
          iconSlug: 'amulet-coin',
          kind: 'relic',
          payload: { relic: 'amuletCoin', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'relic-healing-charm',
          zhName: '治愈护符',
          desc: '永久圣物：每波获胜后存活宝可梦自动恢复 8% 最大 HP',
          tier: 'ub',
          iconSlug: 'soothe-bell',
          kind: 'relic',
          payload: { relic: 'healingCharm', count: 1 },
          needsTargetMember: false,
        },
        {
          id: 'voucher-common-drop',
          zhName: '普通单抽蛋券 ×1',
          desc: '局外永久资产：可在扭蛋工坊抽取 1 枚宝可梦彩蛋！',
          tier: 'ub',
          iconSlug: 'lucky-punch',
          kind: 'voucher',
          payload: { voucher: 'common', count: 1 },
          needsTargetMember: false,
        },
      ];

      if ((run?.relics.teraOrb || 0) === 0) {
        list.unshift({
          id: 'relic-tera-orb',
          zhName: '太晶宝珠',
          desc: '永久圣物：解锁本局每场战斗的【💎 太晶化】属性爆发权限！',
          tier: 'ub',
          iconSlug: 'light-ball',
          kind: 'relic',
          payload: { relic: 'teraOrb', count: 1 },
          needsTargetMember: false,
        });
      }

      if (evoNeeds.length > 0) {
        const evo = evoNeeds[0];
        list.unshift({
          id: `evo-${evo.slug}`,
          zhName: evo.slug === 'linking-cord' ? '联系绳（通信进化）' : evo.zh,
          desc: '立即促使队内满足条件的宝可梦完成进化！',
          tier: 'ub',
          iconSlug: evo.slug === 'linking-cord' ? 'reaper-cloth' : evo.slug,
          kind: 'evo-item',
          payload: { itemSlug: evo.slug },
          needsTargetMember: true,
        });
      }
      return list;
    }

    if (tier === 'gb') {
      const tms = [
        { move: 'flamethrower', icon: 'tm-fire' },
        { move: 'icebeam', icon: 'tm-ice' },
        { move: 'thunderbolt', icon: 'tm-electric' },
        { move: 'earthquake', icon: 'tm-ground' },
        { move: 'shadowball', icon: 'tm-ghost' },
        { move: 'swordsdance', icon: 'tm-normal' },
        { move: 'protect', icon: 'tm-normal' },
      ];
      const tm = tms[Math.floor(Math.random() * tms.length)];
      const shards: Array<{ type: string; zh: string }> = [
        { type: 'Fairy', zh: '妖精太晶碎块' },
        { type: 'Steel', zh: '钢太晶碎块' },
        { type: 'Fire', zh: '火太晶碎块' },
        { type: 'Water', zh: '水太晶碎块' },
        { type: 'Ghost', zh: '幽灵太晶碎块' },
      ];
      const shard = shards[Math.floor(Math.random() * shards.length)];

      const gbList: Omit<RewardDraftItem, 'uid'>[] = [
        {
          id: 'great-ball-pack',
          zhName: '超级球 ×5',
          desc: '补充 5 颗 1.5× 捕获率超级球',
          tier: 'gb',
          iconSlug: 'great-ball',
          kind: 'balls',
          payload: { ball: 'gb', count: 5 },
          needsTargetMember: false,
        },
        {
          id: 'relic-exp-share',
          zhName: '学习装置升级',
          desc: '永久圣物：后排未出战队友分得经验比例 +35%（最高 100%）',
          tier: 'gb',
          iconSlug: 'exp-share',
          kind: 'relic',
          payload: { relic: 'expShare', count: 1 },
          needsTargetMember: false,
        },
        {
          id: `tm-${tm.move}`,
          zhName: `招式学习器：${getMoveZh(tm.move)}`,
          desc: `令选中队员立即习得强力招式【${getMoveZh(tm.move)}】`,
          tier: 'gb',
          iconSlug: tm.icon,
          kind: 'tm',
          payload: { move: tm.move },
          needsTargetMember: true,
        },
        {
          id: 'held-sitrus-berry',
          zhName: '文柚果',
          desc: '携带树果：HP 低于一半时自动回复 25% 最大 HP',
          tier: 'gb',
          iconSlug: 'sitrus-berry',
          kind: 'held-item',
          payload: { item: 'Sitrus Berry' },
          needsTargetMember: true,
        },
        {
          id: 'mint-adamant-modest',
          zhName: '爽朗薄荷',
          desc: '修正宝可梦性格为【爽朗 (+速度 -特攻)】抢占先手线',
          tier: 'gb',
          iconSlug: 'jolly-mint',
          kind: 'mint',
          payload: { nature: 'Jolly' },
          needsTargetMember: true,
        },
      ];

      if ((run?.relics.townMap || 0) === 0) {
        gbList.unshift({
          id: 'relic-town-map',
          zhName: '城镇地图',
          desc: 'PokéRogue 核心路线圣物：每 10 层关底解锁全部 3 条群系路线与道馆情报！',
          tier: 'gb',
          iconSlug: 'town-map',
          kind: 'relic',
          payload: { relic: 'townMap', count: 1 },
          needsTargetMember: false,
        });
      } else if ((run?.relics.teraOrb || 0) > 0) {
        gbList.push({
          id: `shard-${shard.type}`,
          zhName: shard.zh,
          desc: '变更选中队员的太晶属性，定制攻防联防弱点！',
          tier: 'gb',
          iconSlug: 'star-piece',
          kind: 'tera-shard',
          payload: { teraType: shard.type },
          needsTargetMember: true,
        });
      }
      return gbList;
    }

    // tier === 'pb'
    const xBuffs: Array<{ stat: ActiveWaveBuff['stat']; zh: string; slug: string }> = [
      { stat: 'atk', zh: '力量强化 (5波)', slug: 'x-attack' },
      { stat: 'spa', zh: '特攻强化 (5波)', slug: 'x-sp-atk' },
      { stat: 'spe', zh: '速度强化 (5波)', slug: 'x-speed' },
      { stat: 'def', zh: '防御强化 (5波)', slug: 'x-defense' },
    ];
    const xb = xBuffs[Math.floor(Math.random() * xBuffs.length)];

    return [
      {
        id: 'poke-ball-pack',
        zhName: '精灵球 ×5',
        desc: '补充 5 颗基础精灵球，用于野生宝可梦收服扩编',
        tier: 'pb',
        iconSlug: 'poke-ball',
        kind: 'balls',
        payload: { ball: 'pb', count: 5 },
        needsTargetMember: false,
      },
      {
        id: `xbuff-${xb.stat}`,
        zhName: xb.zh,
        desc: '接下来 5 波战斗首发登场自动获得 +1 能力等级提升！',
        tier: 'pb',
        iconSlug: xb.slug,
        kind: 'x-buff',
        payload: { stat: xb.stat, waves: 5 },
        needsTargetMember: false,
      },
      {
        id: 'super-lure-draft',
        zhName: '引虫喷雾·诱饵 (5波)',
        desc: '接下来 5 波大幅提升野生 2v2 双打遭遇概率，刷经验与刷闪翻倍！',
        tier: 'pb',
        iconSlug: 'super-lure',
        kind: 'lure',
        payload: { waves: 5 },
        needsTargetMember: false,
      },
      {
        id: 'held-lum-berry',
        zhName: '木子果',
        desc: '携带树果：陷入任何异常状态时自动解除',
        tier: 'pb',
        iconSlug: 'lum-berry',
        kind: 'held-item',
        payload: { item: 'Lum Berry' },
        needsTargetMember: true,
      },
      {
        id: 'relic-exp-charm',
        zhName: '经验护符',
        desc: '永久圣物：全队获得经验值永久 +25%',
        tier: 'pb',
        iconSlug: 'exp-charm',
        kind: 'relic',
        payload: { relic: 'expCharm', count: 1 },
        needsTargetMember: false,
      },
    ];
  }

  /**
   * 领取免费战利品并推进至下一波（Wave + 1）
   */
  claimRewardAndAdvance(
    reward: RewardDraftItem | null,
    targetMemberUid?: string,
  ): {
    ok: boolean;
    message: string;
    evolved?: { memberUid: string; fromSpecies: string; toSpecies: string; shiny: boolean };
    pendingTmMove?: PendingMoveLearn;
  } {
    if (!this.run) return { ok: false, message: '无存档' };
    const run = this.run;
    let message = '整理行装，迈入下一波遭遇！';
    let evolved: { memberUid: string; fromSpecies: string; toSpecies: string; shiny: boolean } | undefined;
    let pendingTmMove: PendingMoveLearn | undefined;

    if (reward) {
      const target = targetMemberUid
        ? run.party.find((m) => m.uid === targetMemberUid) || run.party[0]
        : run.party[0];

      switch (reward.kind) {
        case 'balls': {
          const b = String(reward.payload.ball) as BallTier;
          const cnt = Number(reward.payload.count) || 5;
          run.balls[b] += cnt;
          message = `获得了 ${reward.zhName}！`;
          break;
        }
        case 'x-buff': {
          const stat = String(reward.payload.stat) as ActiveWaveBuff['stat'];
          const existing = run.waveBuffs.find((w) => w.stat === stat);
          if (existing) {
            existing.stages = Math.min(6, existing.stages + 1);
            existing.wavesLeft = Math.max(existing.wavesLeft, 5);
          } else {
            run.waveBuffs.push({ stat, stages: 1, wavesLeft: 5 });
          }
          message = `${reward.zhName} 生效！接下来 5 波首发登场自动强化！`;
          break;
        }
        case 'lure': {
          run.lureWavesLeft += Number(reward.payload.waves) || 5;
          message = `诱饵生效！接下来 ${run.lureWavesLeft} 波高概率遭遇野生双打！`;
          break;
        }
        case 'relic': {
          const rk = String(reward.payload.relic) as keyof RogueRunSave['relics'];
          if (rk in run.relics) {
            run.relics[rk] += Number(reward.payload.count) || 1;
          }
          message = `获得了永久圣物【${reward.zhName}】！`;
          break;
        }
        case 'voucher': {
          const vt = String(reward.payload.voucher) as VoucherTier;
          SaveStorage.addVoucher(vt, Number(reward.payload.count) || 1);
          message = `🎉 获得了【${reward.zhName}】！已存入主菜单扭蛋工坊！`;
          break;
        }
        case 'held-item': {
          const item = String(reward.payload.item);
          target.set.item = item;
          message = `${getSpeciesZh(target.set.species)} 携带了【${reward.zhName}】！`;
          break;
        }
        case 'tera-shard': {
          const tType = String(reward.payload.teraType || 'Stellar');
          target.set.teraType = tType;
          message = `💎 ${getSpeciesZh(target.set.species)} 的太晶属性已变更为【${reward.zhName.replace('太晶碎块', '')}】！`;
          break;
        }
        case 'mint': {
          target.set.nature = String(reward.payload.nature || 'Jolly');
          message = `${getSpeciesZh(target.set.species)} 服用了【${reward.zhName}】！`;
          break;
        }
        case 'evo-item': {
          const slug = String(reward.payload.itemSlug);
          const meta = getSpeciesMeta(target.set.species);
          const rule = meta?.evos.find((e) => e.item === slug || (slug === 'linking-cord' && e.trigger === 'linking-cord'));
          if (!rule) {
            return { ok: false, message: `${getSpeciesZh(target.set.species)} 无法使用该进化道具，请选择可进化的队友` };
          }
          const fromSp = target.set.species;
          const nextSp = Dex.species.get(rule.to);
          this.applyMemberEvolution(target, nextSp.name);
          evolved = {
            memberUid: target.uid,
            fromSpecies: fromSp,
            toSpecies: nextSp.name,
            shiny: Boolean(target.set.shiny),
          };
          message = `🌟 ${getSpeciesZh(fromSp)} 进化成了 ${getSpeciesZh(nextSp.name)}！`;
          break;
        }
        case 'tm': {
          const mvId = toID(String(reward.payload.move));
          if (target.set.moves.map(toID).includes(mvId)) {
            return { ok: false, message: `${getSpeciesZh(target.set.species)} 已经会这招了！` };
          }
          if (target.set.moves.length < 4) {
            target.set.moves.push(mvId);
            const dm = Dex.moves.get(mvId);
            target.movePp[dm.id] = dm.pp || 15;
            message = `${getSpeciesZh(target.set.species)} 学会了【${getMoveZh(mvId)}】！`;
          } else {
            pendingTmMove = {
              memberUid: target.uid,
              speciesZh: getSpeciesZh(target.set.species),
              newMoveId: mvId,
              newMoveZh: getMoveZh(mvId),
            };
          }
          break;
        }
      }
    }

    run.wave += 1;
    run.inShopPhase = false;
    run.rerollCount = 0;
    run.rarityLocked = false;
    run.pendingBiomeChoices = undefined;
    SaveStorage.saveRogueRun(run);
    return { ok: true, message, evolved, pendingTmMove };
  }
}
