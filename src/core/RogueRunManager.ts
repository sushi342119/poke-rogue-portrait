import { Dex, toID, type PokemonSet } from '@pkmn/sim';
import { BIOMES, getWaveLevelCap, type BiomeConfig } from '../config/constants';
import { TRAINER_PROFILES, type TrainerProfile } from '../config/presets';
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
import {
  SaveStorage,
  type ActiveWaveBuff,
  type RogueMemberState,
  type RogueRunSave,
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
    | 'relic'
    | 'held-item'
    | 'tm'
    | 'evo-item'
    | 'mint'
    | 'candy';
  payload: Record<string, string | number>;
  needsTargetMember: boolean;
}

export interface WaveEncounterSpec {
  wave: number;
  biome: BiomeConfig;
  kind: 'wild' | 'trainer' | 'elite' | 'boss';
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
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function estimateMaxHp(speciesName: string, level: number, ivHp = 24, evHp = 0): number {
  const sp = Dex.species.get(speciesName);
  if (sp.id === 'shedinja') return 1;
  const base = sp.baseStats?.hp || 65;
  return Math.floor(((2 * base + ivHp + Math.floor(evHp / 4)) * level) / 100) + level + 10;
}

export function createRogueMember(speciesNameOrId: string, level = 5, forceShiny?: boolean): RogueMemberState {
  const sp = Dex.species.get(speciesNameOrId);
  const species = sp.exists ? sp.name : 'Charmander';
  const meta = getSpeciesMeta(species);
  const moves = getStartingMovesForLevel(species, level);
  const natures = ['Hardy', 'Adamant', 'Jolly', 'Modest', 'Timid', 'Bold', 'Calm', 'Brave'];
  const nature = natures[Math.floor(Math.random() * natures.length)];
  const shiny = forceShiny ?? Math.random() < 1 / 64;
  const maxhp = estimateMaxHp(species, level);

  const movePp: Record<string, number> = {};
  for (const m of moves) {
    const dm = Dex.moves.get(m);
    movePp[dm.id] = dm.pp ? Math.floor(dm.pp * 1.0) : 15;
  }

  const set: PokemonSet = {
    name: species,
    species,
    item: '',
    ability: sp.abilities?.[0] || 'Blaze',
    moves,
    nature,
    gender: sp.gender || (Math.random() < 0.5 ? 'M' : 'F'),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 24, atk: 24, def: 24, spa: 24, spd: 24, spe: 24 },
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
  };
}

/**
 * PokéRogue 原味无尽 1v1 肉鸽核心状态机：
 * 涵盖 10 费选宠/三选一开局、波次与群系轮转、硬性等级上限、精确捕获公式、Boss 多段护盾、双轨商店与球色品质三选一
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

  /**
   * 计算宝可梦实际开局费用（已收集糖果可降低最多 2 点费用，最低 1 费）
   */
  getEffectiveStarterCost(speciesId: string): number {
    const meta = getSpeciesMeta(speciesId);
    const baseCost = meta?.cost || 3;
    const candies = SaveStorage.getMeta().starterCandies[toID(speciesId)] || 0;
    const discount = candies >= 15 ? 2 : candies >= 5 ? 1 : 0;
    return Math.max(1, baseCost - discount);
  }

  /**
   * 快捷生成平衡御三家/人气新星随机三选一候选池
   */
  rollQuickStarterTrio(): string[] {
    const firePool = ['charmander', 'cyndaquil', 'torchic', 'chimchar', 'fuecoco', 'litten', 'growlithe', 'charcadet'];
    const waterPool = ['squirtle', 'totodile', 'mudkip', 'piplup', 'froakie', 'oshawott', 'quaxly', 'poliwag'];
    const grassOrAcePool = ['bulbasaur', 'treecko', 'turtwig', 'rowlet', 'sprigatito', 'riolu', 'ralts', 'gible'];
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return [pick(grassOrAcePool), pick(firePool), pick(waterPool)];
  }

  startNewRun(starterSpeciesIds: string[]): RogueRunSave {
    const chosen = starterSpeciesIds.slice(0, 3);
    const party = chosen.map((id) => createRogueMember(id, 5));

    const meta = SaveStorage.getMeta();
    meta.totalRogueRuns += 1;
    SaveStorage.saveMeta(meta);

    this.run = {
      version: 1,
      wave: 1,
      biomeIndex: 0,
      money: 1000,
      balls: { pb: 5, gb: 1, ub: 0, mb: 0 },
      relics: {
        expShare: 1, // PokéRogue 默认携带基础学习装置保证顺滑养成
        luckyEgg: 0,
        expCharm: 0,
        amuletCoin: 0,
        healingCharm: 0,
        shinyCharm: 0,
      },
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
    const idx = (this.run?.biomeIndex || 0) % BIOMES.length;
    return BIOMES[idx];
  }

  /**
   * 队伍闪光幸运值（每只存活闪光宝可梦提供 +1 Luck，提升免费战利品球品质升级概率）
   */
  getPartyLuckPoints(): number {
    if (!this.run) return 0;
    return this.run.party.filter((m) => !m.fainted && m.set.shiny).length;
  }

  getPartyLuckGrade(): string {
    const pts = this.getPartyLuckPoints();
    if (pts >= 4) return 'SSS';
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

  /**
   * 生成当前波次的野生 / 训练家 / 5 层精英 / 10 层 Boss 遭遇
   */
  generateCurrentWaveEncounter(): WaveEncounterSpec {
    if (!this.run) {
      this.startNewRun(['charmander']);
    }
    const run = this.run!;
    const wave = run.wave;
    const biome = this.getCurrentBiome();
    const cap = getWaveLevelCap(wave);
    const waveInChapter = ((wave - 1) % 10) + 1;

    // 计算当前波次合理敌方等级
    const prevCap = wave <= 10 ? 2 : getWaveLevelCap(wave - 10);
    const progress = waveInChapter / 10;
    const baseEnemyLv = Math.max(2, Math.round(prevCap + (cap - prevCap) * progress * 0.92));

    // 第 10 / 20 / 30... 波：关底多段护盾霸主 Boss！
    if (wave % 10 === 0) {
      const bossMon = this.pickBiomePokemon(biome, wave, true);
      const bossLv = Math.max(baseEnemyLv + 2, cap);
      const bossSet = this.createEnemyPokemonSet(bossMon, bossLv, true);
      const shields = wave >= 50 ? 4 : wave >= 20 ? 3 : 2;
      return {
        wave,
        biome,
        kind: 'boss',
        titleZh: `第 ${wave} 波 · 群系霸主 ${getSpeciesZh(bossMon)}`,
        enemyTeam: [bossSet],
        bossShields: shields,
        canCatch: true, // 击破霸主全部护盾后允许投球收服！
      };
    }

    // 第 5 / 15 / 25... 波：精英训练家对战！
    if (wave % 5 === 0) {
      const trainer = TRAINER_PROFILES[(Math.floor(wave / 5) - 1) % TRAINER_PROFILES.length];
      const teamCount = Math.min(4, 2 + Math.floor(wave / 15));
      const enemyTeam: PokemonSet[] = [];
      for (let i = 0; i < teamCount; i++) {
        const spName = this.pickBiomePokemon(biome, wave + 4, i === teamCount - 1);
        enemyTeam.push(this.createEnemyPokemonSet(spName, baseEnemyLv + (i === teamCount - 1 ? 1 : 0), true));
      }
      return {
        wave,
        biome,
        kind: 'elite',
        titleZh: `第 ${wave} 波 · 精英战 ${trainer.titleZh}${trainer.zhName}`,
        trainer,
        enemyTeam,
        bossShields: 0,
        canCatch: false,
      };
    }

    // 普通波次偶遇路人训练家（每章第 7 波）
    if (waveInChapter === 7 && wave > 3) {
      const trainer = TRAINER_PROFILES[wave % TRAINER_PROFILES.length];
      const count = wave >= 17 ? 2 : 1;
      const enemyTeam = Array.from({ length: count }, () =>
        this.createEnemyPokemonSet(this.pickBiomePokemon(biome, wave, false), baseEnemyLv, false),
      );
      return {
        wave,
        biome,
        kind: 'trainer',
        titleZh: `第 ${wave} 波 · 训练家 ${trainer.zhName}`,
        trainer,
        enemyTeam,
        bossShields: 0,
        canCatch: false,
      };
    }

    // 默认野生宝可梦遭遇（支持精灵球收服扩编！）
    const wildSp = this.pickBiomePokemon(biome, wave, false);
    const shinyChance = (1 + run.relics.shinyCharm * 3) / 128;
    const wildSet = this.createEnemyPokemonSet(wildSp, baseEnemyLv, false, Math.random() < shinyChance);

    return {
      wave,
      biome,
      kind: 'wild',
      titleZh: `第 ${wave} 波 · 野生 ${getSpeciesZh(wildSp)}`,
      enemyTeam: [wildSet],
      bossShields: 0,
      canCatch: true,
    };
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

  /**
   * 精确计算当前野生宝可梦捕获成功率（0 ~ 100%）与投球判定
   */
  estimateCatchProbability(
    ball: BallTier,
    speciesName: string,
    hpPercent: number,
    status: string,
    remainingBossShields = 0,
  ): number {
    if (remainingBossShields > 0) return 0; // PokéRogue 规则：必须先击破霸主全部护盾才能投球捕获！
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
      SaveStorage.unlockStarterAndCandy(baseId, enemySet.shiny ? 5 : 2);
    }
    SaveStorage.saveRogueRun(this.run);
    return { ok: true, caught, shakes, catchPct };
  }

  addCapturedToParty(enemySet: PokemonSet, replaceIndex?: number): RogueMemberState {
    const member = createRogueMember(enemySet.species, enemySet.level || 5, enemySet.shiny);
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
   * 同步战斗结束后的队伍剩余 HP / 异常状态 / PP，并结算金币、经验、等级上限、新招式与进化
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

    // 1. 同步战斗损耗与治疗护符被动回复
    for (let i = 0; i < run.party.length; i++) {
      const m = run.party[i];
      const p = persistedParty[i];
      if (!p) continue;
      m.maxhp = p.maxhp;
      m.hp = p.hp;
      m.fainted = p.fainted;
      m.status = p.status;
      m.movePp = { ...m.movePp, ...p.movePp };

      if (!m.fainted && run.relics.healingCharm > 0) {
        const healAmt = Math.max(1, Math.floor(m.maxhp * 0.08 * run.relics.healingCharm));
        m.hp = Math.min(m.maxhp, m.hp + healAmt);
      }
    }

    // 2. 递减 5 波强化药剂剩余波数
    for (const buff of run.waveBuffs) {
      buff.wavesLeft -= 1;
    }
    run.waveBuffs = run.waveBuffs.filter((b) => b.wavesLeft > 0);

    // 3. 金币奖励（护符金币每层 +25%）
    const baseMoney =
      encounter.kind === 'boss'
        ? 420 + run.wave * 35
        : encounter.kind === 'elite'
          ? 260 + run.wave * 24
          : encounter.kind === 'trainer'
            ? 150 + run.wave * 16
            : 65 + run.wave * 9;
    const moneyGained = Math.round(baseMoney * (1 + run.relics.amuletCoin * 0.25));
    run.money += moneyGained;

    // 4. 经验结算与学习装置分配
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
        expLogs.push(`${getSpeciesZh(m.set.species)} 已达当前章节等级上限 Lv.${cap}`);
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

        // 检查新学会招式
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

        // 检查等级进化 / 亲密度自然进化
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

    // 5. 第 10 波关底通关：全队满状态恢复 + 群系轮转！
    let biomeCleared = false;
    let nextBiomeZh: string | undefined;
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
      run.biomeIndex = (run.biomeIndex + 1) % BIOMES.length;
      nextBiomeZh = BIOMES[run.biomeIndex].zhName;
    }

    // 更新最高层数纪录
    const meta = SaveStorage.getMeta();
    if (run.wave > meta.highestRogueWave) {
      meta.highestRogueWave = run.wave;
      SaveStorage.saveMeta(meta);
    }

    run.inShopPhase = true;
    run.rerollCount = 0;
    SaveStorage.saveRogueRun(run);

    return {
      moneyGained,
      expLogs,
      evolutions,
      pendingMoveLearns,
      biomeCleared,
      nextBiomeZh,
    };
  }

  applyMemberEvolution(member: RogueMemberState, targetSpeciesName: string): void {
    const newSp = Dex.species.get(targetSpeciesName);
    if (!newSp.exists) return;
    member.set.species = newSp.name;
    member.set.name = newSp.name;
    member.set.ability = newSp.abilities?.[0] || member.set.ability;
    const oldMax = member.maxhp;
    member.maxhp = estimateMaxHp(newSp.name, member.set.level || 16);
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

  handleRunDefeat(): number {
    const reachedWave = this.run?.wave || 1;
    const meta = SaveStorage.getMeta();
    if (reachedWave > meta.highestRogueWave) {
      meta.highestRogueWave = reachedWave;
      SaveStorage.saveMeta(meta);
    }
    SaveStorage.clearRogueRun();
    this.run = null;
    return reachedWave;
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
    const member = this.run.party.find((m) => m.uid === memberUid);
    if (!item || !member) return { ok: false, message: '未找到目标宝可梦' };
    if (this.run.money < item.cost) return { ok: false, message: '金币不足！' };

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
        member.maxhp = estimateMaxHp(member.set.species, member.set.level);
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
    return Math.round(base * Math.pow(1.65, this.run.rerollCount));
  }

  /**
   * PokéRogue 第二轨：抽取 3 张精灵球品质免费战利品（含精英/Boss 保底与闪光幸运值升档）
   */
  rollFreeRewardDraft(isReroll = false): { ok: boolean; reason?: string; items: RewardDraftItem[] } {
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
    const isElite = this.run.wave % 5 === 0;

    const rollTier = (slotIdx: number): BallTier => {
      if (slotIdx === 0 && isBoss) return Math.random() < 0.35 + luck * 0.06 ? 'mb' : 'ub';
      if (slotIdx === 0 && isElite) return Math.random() < 0.4 + luck * 0.05 ? 'ub' : 'gb';
      const r = Math.random() * 100 - luck * 4.5;
      if (r < 3.5) return 'mb';
      if (r < 19) return 'ub';
      if (r < 52) return 'gb';
      return 'pb';
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
    // 检查队内是否有需要进化石或联系绳进化的成员，动态加入奖池（PokéRogue 智能掉落设计！）
    const evoNeeds: Array<{ slug: string; zh: string }> = [];
    for (const m of this.run?.party || []) {
      const meta = getSpeciesMeta(m.set.species);
      for (const evo of meta?.evos || []) {
        if ((evo.trigger === 'item' || evo.trigger === 'linking-cord') && evo.item) {
          evoNeeds.push({ slug: evo.item, zh: getItemZh(evo.item) });
        }
      }
    }

    if (tier === 'mb') {
      return [
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
          desc: '永久圣物：大幅提升野生闪光宝可梦出现率与队伍气运',
          tier: 'mb',
          iconSlug: 'oval-charm',
          kind: 'relic',
          payload: { relic: 'shinyCharm', count: 1 },
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
          zhName: '安抚之铃·治愈护符',
          desc: '永久圣物：每波获胜后存活宝可梦自动恢复 8% 最大 HP',
          tier: 'ub',
          iconSlug: 'soothe-bell',
          kind: 'relic',
          payload: { relic: 'healingCharm', count: 1 },
          needsTargetMember: false,
        },
      ];

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

      return [
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
          desc: `令任一队员立即习得强力招式【${getMoveZh(tm.move)}】`,
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
    }

    // tier === 'pb' (Common 红白球品质：精灵球、5 波强化药剂、基础果子)
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
        desc: 'PokéRogue 核心运营药剂：接下来 5 波战斗首发自动获得 +1 能力提升！',
        tier: 'pb',
        iconSlug: xb.slug,
        kind: 'x-buff',
        payload: { stat: xb.stat, waves: 5 },
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
        case 'relic': {
          const rk = String(reward.payload.relic) as keyof RogueRunSave['relics'];
          if (rk in run.relics) {
            run.relics[rk] += Number(reward.payload.count) || 1;
          }
          message = `获得了永久圣物【${reward.zhName}】！`;
          break;
        }
        case 'held-item': {
          const item = String(reward.payload.item);
          target.set.item = item;
          message = `${getSpeciesZh(target.set.species)} 携带了【${reward.zhName}】！`;
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
    SaveStorage.saveRogueRun(run);
    return { ok: true, message, evolved, pendingTmMove };
  }
}
