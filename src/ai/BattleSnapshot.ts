import {
  BattleEngine,
  type ParsedSideRequest,
  type TrackedFieldState,
  type TrackedSlotState,
} from '../core/BattleEngine';
import type { BattleSlotId } from '../config/constants';
import { calcSpeedTierRange } from '../data/dexRegistry';

export interface PublicVisibleOpponent {
  slot: BattleSlotId;
  species: string;
  zhSpecies: string;
  level: number;
  hpPercent: number;
  status: string;
  types: string[];
  terastallized: string;
  boosts: Record<string, number>;
  volatiles: string[];
  revealedAbility: string;
  revealedItem: string;
  revealedMoves: string[];
  speedRange: { minSpe: number; maxSpe: number; scarfSpe: number };
}

export interface AIBattleSnapshot {
  turn: number;
  isDoubles: boolean;
  isTeamPreview: boolean;
  isForceSwitch: boolean;
  weather: string;
  terrain: string;
  trickRoomActive: boolean;
  aiTailwind: boolean;
  playerTailwind: boolean;
  aiSideHazards: string[];
  playerSideHazards: string[];
  aiActive: Array<{
    slotIndex: number;
    species: string;
    zhName: string;
    level: number;
    hpPercent: number;
    status: string;
    stats: { atk: number; def: number; spa: number; spd: number; spe: number };
    boosts: Record<string, number>;
    ability: string;
    item: string;
    canTerastallize?: string;
    moves: Array<{
      index: number;
      id: string;
      zhName: string;
      type: string;
      category: string;
      basePower: number;
      pp: number;
      target: string;
      disabled: boolean;
    }>;
  }>;
  aiBench: Array<{
    index: number;
    species: string;
    zhName: string;
    level: number;
    hpPercent: number;
    status: string;
    ability: string;
    item: string;
    moves: string[];
  }>;
  playerActive: PublicVisibleOpponent[];
  playerAliveCount: number;
  legalChoicesBySlot: string[][];
}

export interface AIDecisionResult {
  choiceString: string;
  thoughtSummary: string;
  speechBubble: string;
  source: 'heuristic' | 'llm' | 'llm-fallback';
}

export type TrainerPersonality = 'rival' | 'champion' | 'scientist' | 'boss' | 'wild';

/**
 * 构建严格遵守战争迷雾（Fog of War）的 AI 战场态势快照：
 * 绝不暴露玩家未上场的后排宝可梦、未使出的招式、未触发的道具或本回合预选指令
 */
export function buildAISnapshot(
  engine: BattleEngine,
  p2Req: ParsedSideRequest,
): AIBattleSnapshot {
  const field: TrackedFieldState = engine.field;
  const trickRoomActive = Object.keys(field.pseudoWeather).some((k) =>
    k.toLowerCase().includes('trickroom') || k.toLowerCase().includes('trick room'),
  );

  const playerActiveSlots: BattleSlotId[] = field.isDoubles ? ['p1a', 'p1b'] : ['p1a'];
  const playerActive: PublicVisibleOpponent[] = [];

  for (const s of playerActiveSlots) {
    const tracked: TrackedSlotState | undefined = engine.slots.get(s);
    if (!tracked || tracked.fainted) continue;
    const speRange = calcSpeedTierRange(tracked.species, tracked.level);
    playerActive.push({
      slot: s,
      species: tracked.species,
      zhSpecies: tracked.zhSpecies,
      level: tracked.level,
      hpPercent: tracked.hpPercent,
      status: tracked.status,
      types: [...tracked.types],
      terastallized: tracked.terastallized,
      boosts: { ...tracked.boosts },
      volatiles: [...tracked.volatiles],
      revealedAbility: tracked.revealedAbility || '未知',
      revealedItem: tracked.revealedItem || '未知',
      revealedMoves: Object.keys(tracked.revealedMoves),
      speedRange: {
        minSpe: speRange.minSpe,
        maxSpe: speRange.maxSpe,
        scarfSpe: speRange.scarfSpe,
      },
    });
  }

  const aiActive: AIBattleSnapshot['aiActive'] = [];
  const activeMonList = p2Req.side.pokemon.filter((p) => p.active);
  const slotCount = p2Req.forceSwitch
    ? p2Req.forceSwitch.length
    : p2Req.active
      ? p2Req.active.length
      : 1;

  for (let i = 0; i < slotCount; i++) {
    const sideMon = activeMonList[i];
    const reqSlot = p2Req.active?.[i];
    const tracked = engine.slots.get(i === 0 ? 'p2a' : 'p2b');
    if (!sideMon) continue;
    aiActive.push({
      slotIndex: i,
      species: sideMon.species,
      zhName: sideMon.zhName,
      level: sideMon.level,
      hpPercent: sideMon.hpPercent,
      status: sideMon.status,
      stats: sideMon.stats,
      boosts: tracked ? { ...tracked.boosts } : { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ability: sideMon.ability,
      item: sideMon.item,
      canTerastallize: reqSlot?.canTerastallize,
      moves: (reqSlot?.moves || []).map((m) => ({
        index: m.index,
        id: m.id,
        zhName: m.zhName,
        type: m.type,
        category: m.category,
        basePower: m.basePower,
        pp: m.pp,
        target: m.target,
        disabled: m.disabled,
      })),
    });
  }

  const aiBench = p2Req.side.pokemon
    .filter((p) => !p.active && !p.fainted)
    .map((b) => ({
      index: b.index,
      species: b.species,
      zhName: b.zhName,
      level: b.level,
      hpPercent: b.hpPercent,
      status: b.status,
      ability: b.ability,
      item: b.item,
      moves: b.moves,
    }));

  const legalChoicesBySlot: string[][] = [];
  const tempUsed = new Set<number>();
  for (let i = 0; i < slotCount; i++) {
    legalChoicesBySlot.push(BattleEngine.enumerateLegalChoicesForSlot(p2Req, i, tempUsed));
  }

  const playerAliveCount = field.partyBalls.p1.filter((b) => !b.fainted).length;

  return {
    turn: field.turn,
    isDoubles: field.isDoubles,
    isTeamPreview: Boolean(p2Req.teamPreview),
    isForceSwitch: Boolean(p2Req.forceSwitch?.some(Boolean)),
    weather: field.weather,
    terrain: field.terrain,
    trickRoomActive,
    aiTailwind: Boolean(field.sideConditions.p2['Tailwind']),
    playerTailwind: Boolean(field.sideConditions.p1['Tailwind']),
    aiSideHazards: Object.keys(field.sideConditions.p2),
    playerSideHazards: Object.keys(field.sideConditions.p1),
    aiActive,
    aiBench,
    playerActive,
    playerAliveCount,
    legalChoicesBySlot,
  };
}
