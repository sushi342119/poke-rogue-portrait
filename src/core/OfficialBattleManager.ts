import { Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { TeamGenerators } from '@pkmn/randoms';
import {
  PRESET_TEAMS,
  TRAINER_PROFILES,
  importShowdownPaste,
  type TrainerProfile,
} from '../config/presets';
import { getStartingMovesForLevel } from '../data/dexRegistry';
import { SaveStorage } from './SaveStorage';

Teams.setGeneratorFactory(TeamGenerators);

export type OfficialSubMode = 'free' | 'factory';

export interface FactoryRunSession {
  isDoubles: boolean;
  streak: number;
  draftPool: PokemonSet[];
  playerTeam: PokemonSet[];
  lastOpponentTeam: PokemonSet[];
}

function normalizeToLevel50(set: PokemonSet): PokemonSet {
  return {
    ...set,
    name: set.species,
    level: 50,
    ivs: set.ivs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: set.evs || { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 },
  };
}

/**
 * 生成指定数量的不重复竞技级 Lv.50 宝可梦成品配置（基于 @pkmn/randoms）
 */
export function generateCompetitivePool(count: number, isDoubles: boolean): PokemonSet[] {
  const format = isDoubles ? 'gen9randomdoublesbattle' : 'gen9randombattle';
  const gen = Teams.getGenerator(format);
  const pool: PokemonSet[] = [];
  const usedBase = new Set<string>();

  let safety = 0;
  while (pool.length < count && safety < 12) {
    safety++;
    const batch = gen.getTeam();
    for (const raw of batch) {
      const sp = Dex.species.get(raw.species);
      const baseId = toID(sp.baseSpecies || raw.species);
      if (usedBase.has(baseId)) continue;
      usedBase.add(baseId);
      pool.push(normalizeToLevel50(raw));
      if (pool.length >= count) break;
    }
  }
  return pool;
}

/**
 * 根据物种快速生成一套合理的 Lv.50 自定义初始配置（供自由编队器添加新宝可梦时使用）
 */
export function buildDefaultCompetitiveSet(speciesNameOrId: string): PokemonSet {
  const sp = Dex.species.get(speciesNameOrId);
  const species = sp.exists ? sp.name : 'Pikachu';
  const isPhysical = (sp.baseStats?.atk || 80) >= (sp.baseStats?.spa || 80);
  const isSlow = (sp.baseStats?.spe || 80) <= 60;

  const evs = isSlow
    ? { hp: 252, atk: isPhysical ? 252 : 0, def: 4, spa: isPhysical ? 0 : 252, spd: 0, spe: 0 }
    : { hp: 4, atk: isPhysical ? 252 : 0, def: 0, spa: isPhysical ? 0 : 252, spd: 0, spe: 252 };

  const nature = isSlow
    ? isPhysical
      ? 'Brave'
      : 'Quiet'
    : isPhysical
      ? 'Jolly'
      : 'Timid';

  const ability = sp.abilities?.[0] || 'Overgrow';
  const starterMoves = getStartingMovesForLevel(species, 65);

  return {
    name: species,
    species,
    item: isSlow ? 'Sitrus Berry' : 'Life Orb',
    ability,
    moves: starterMoves.slice(0, 4),
    nature,
    gender: '',
    evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    teraType: sp.types?.[0] || 'Normal',
  };
}

/**
 * 正统对战模式管理器（Lv.50 单打 3v3 / 双打 4v4：自由编队 + 对战工厂）
 */
export class OfficialBattleManager {
  private factorySession: FactoryRunSession | null = null;

  pickRandomOpponentTrainer(): TrainerProfile {
    const idx = Math.floor(Math.random() * TRAINER_PROFILES.length);
    return TRAINER_PROFILES[idx];
  }

  generateOpponentTeam(isDoubles: boolean, fullSixForPreview = true): PokemonSet[] {
    if (Math.random() < 0.45) {
      const compatible = PRESET_TEAMS.filter(
        (t) => t.recommendedMode === 'both' || t.recommendedMode === (isDoubles ? 'doubles' : 'singles'),
      );
      const picked = compatible[Math.floor(Math.random() * compatible.length)] || PRESET_TEAMS[0];
      const sets = importShowdownPaste(picked.paste, true);
      if (sets.length >= 4) {
        return fullSixForPreview ? sets.slice(0, 6) : sets.slice(0, isDoubles ? 4 : 3);
      }
    }
    return generateCompetitivePool(fullSixForPreview ? 6 : isDoubles ? 4 : 3, isDoubles);
  }

  startFactorySession(isDoubles: boolean): FactoryRunSession {
    const poolSize = isDoubles ? 8 : 6;
    const draftPool = generateCompetitivePool(poolSize, isDoubles);
    this.factorySession = {
      isDoubles,
      streak: 0,
      draftPool,
      playerTeam: [],
      lastOpponentTeam: [],
    };
    return this.factorySession;
  }

  getFactorySession(): FactoryRunSession | null {
    return this.factorySession;
  }

  lockFactoryDraft(indices: number[]): PokemonSet[] {
    if (!this.factorySession) return [];
    const needed = this.factorySession.isDoubles ? 4 : 3;
    const chosen = indices
      .slice(0, needed)
      .map((i) => this.factorySession!.draftPool[i])
      .filter(Boolean);
    this.factorySession.playerTeam = chosen;
    return chosen;
  }

  prepareNextFactoryOpponent(): { trainer: TrainerProfile; team: PokemonSet[] } {
    const isDoubles = this.factorySession?.isDoubles ?? false;
    const count = isDoubles ? 4 : 3;
    const team = generateCompetitivePool(count, isDoubles);
    if (this.factorySession) {
      this.factorySession.lastOpponentTeam = team;
    }
    return {
      trainer: this.pickRandomOpponentTrainer(),
      team,
    };
  }

  recordFactoryResult(won: boolean): { streak: number; bestStreak: number } {
    const meta = SaveStorage.getMeta();
    if (!this.factorySession) {
      return { streak: 0, bestStreak: meta.factoryBestStreakSingles };
    }
    if (won) {
      this.factorySession.streak += 1;
      if (this.factorySession.isDoubles) {
        meta.factoryBestStreakDoubles = Math.max(meta.factoryBestStreakDoubles, this.factorySession.streak);
      } else {
        meta.factoryBestStreakSingles = Math.max(meta.factoryBestStreakSingles, this.factorySession.streak);
      }
      meta.officialWins += 1;
      SaveStorage.saveMeta(meta);
    } else {
      this.factorySession.streak = 0;
    }
    const best = this.factorySession.isDoubles
      ? meta.factoryBestStreakDoubles
      : meta.factoryBestStreakSingles;
    return { streak: this.factorySession.streak, bestStreak: best };
  }

  /**
   * 对战工厂连胜后特色换宠机制：用本场击败对手的 1 只宝可梦替换己方 1 只
   */
  swapFactoryMember(ownIndex: number, opponentIndex: number): void {
    if (!this.factorySession) return;
    const opp = this.factorySession.lastOpponentTeam[opponentIndex];
    if (opp && this.factorySession.playerTeam[ownIndex]) {
      this.factorySession.playerTeam[ownIndex] = { ...opp };
    }
  }
}
