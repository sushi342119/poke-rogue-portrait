import { Dex, toID } from '@pkmn/dex';
import type { BattleEngine, ParsedSideRequest } from '../core/BattleEngine';
import { getMoveZh, getSpeciesZh, getTypeEffectiveness } from '../data/dexRegistry';
import {
  buildAISnapshot,
  type AIBattleSnapshot,
  type AIDecisionResult,
  type PublicVisibleOpponent,
  type TrainerPersonality,
} from './BattleSnapshot';

const IMMUNITY_ABILITIES: Record<string, string[]> = {
  levitate: ['Ground'],
  eartheater: ['Ground'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  waterabsorb: ['Water'],
  stormdrain: ['Water'],
  dryskin: ['Water'],
  flashfire: ['Fire'],
  wellbakedbody: ['Fire'],
  sapsipper: ['Grass'],
};

function stageMult(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage || 0));
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}

function checkLikelyImmuneByAbility(moveType: string, targetSpecies: string, revealedAbility: string): boolean {
  const sp = Dex.species.get(targetSpecies);
  const possibleAbilities = sp.exists ? Object.values(sp.abilities).map((a) => toID(a)) : [];
  const revId = toID(revealedAbility);
  for (const [abId, types] of Object.entries(IMMUNITY_ABILITIES)) {
    if (types.includes(moveType)) {
      if (revId === abId) return true;
      // 若该宝可梦唯一常规特性即免疫特性（如飘浮多龙/钢钟/清洗洛托姆），AI 会像人类高手一样规避
      if (possibleAbilities.length === 1 && possibleAbilities[0] === abId) return true;
    }
  }
  return false;
}

function estimateMoveDamageScore(
  attacker: AIBattleSnapshot['aiActive'][number],
  move: AIBattleSnapshot['aiActive'][number]['moves'][number],
  target: PublicVisibleOpponent,
  snap: AIBattleSnapshot,
  considerTeraType?: string,
): { expectedPct: number; eff: number; reason: string } {
  const dexMv = Dex.moves.get(move.id);
  const attackerSp = Dex.species.get(attacker.species);
  const attackerTypes = considerTeraType
    ? [considerTeraType]
    : attackerSp.exists
      ? attackerSp.types
      : ['Normal'];

  if (move.category === 'Status') {
    return evaluateStatusMove(attacker, move.id, target, snap);
  }

  let moveType = move.type;
  if (move.id === 'terablast' && considerTeraType) {
    moveType = considerTeraType;
  }

  if (checkLikelyImmuneByAbility(moveType, target.species, target.revealedAbility)) {
    return { expectedPct: 0, eff: 0, reason: `${target.zhSpecies}特性大概率免疫${moveType}` };
  }

  const eff = getTypeEffectiveness(moveType, target.types);
  if (eff === 0) {
    return { expectedPct: 0, eff: 0, reason: `属性免疫` };
  }

  let bp = move.basePower || 65;
  if (dexMv.multihit) {
    const avgHits = Array.isArray(dexMv.multihit)
      ? (dexMv.multihit[0] + dexMv.multihit[1]) / 2
      : dexMv.multihit;
    bp *= avgHits;
  }
  if (['knockoff', 'acrobatics', 'hex', 'venoshock', 'facade'].includes(move.id)) {
    bp = Math.max(bp, 95);
  }

  const hasOriginalStab = attackerSp.exists && (attackerSp.types as readonly string[]).includes(moveType);
  let stab = 1;
  if (considerTeraType && considerTeraType === moveType) {
    stab = hasOriginalStab ? 2.0 : 1.5;
  } else if (hasOriginalStab) {
    stab = 1.5;
  }

  let weatherMult = 1;
  const w = snap.weather.toLowerCase();
  if (w.includes('sun') || w.includes('desolate')) {
    if (moveType === 'Fire') weatherMult = 1.5;
    if (moveType === 'Water') weatherMult = 0.5;
  } else if (w.includes('rain') || w.includes('primordial')) {
    if (moveType === 'Water') weatherMult = 1.5;
    if (moveType === 'Fire') weatherMult = 0.5;
  }

  const isPhys = move.category === 'Physical';
  const atkStat = (isPhys ? attacker.stats.atk : attacker.stats.spa) *
    stageMult(isPhys ? attacker.boosts.atk : attacker.boosts.spa);
  const targetDex = Dex.species.get(target.species);
  const baseDef = targetDex.exists
    ? isPhys
      ? targetDex.baseStats.def
      : targetDex.baseStats.spd
    : 85;
  const estDef = (((2 * baseDef + 31) * target.level) / 100 + 5) *
    stageMult(isPhys ? target.boosts.def : target.boosts.spd);

  const burnPenalty = isPhys && attacker.status === 'brn' && toID(attacker.ability) !== 'guts' ? 0.5 : 1;
  const spreadPenalty = snap.isDoubles && ['allAdjacentFoes', 'allAdjacent'].includes(move.target) && snap.playerActive.length > 1 ? 0.75 : 1;
  const accFactor = typeof dexMv.accuracy === 'number' ? Math.min(1, dexMv.accuracy / 100) : 1;

  const rawHpRatio =
    ((((2 * attacker.level) / 5 + 2) * bp * (atkStat / Math.max(25, estDef))) / 50 + 2) /
    Math.max(60, ((2 * (targetDex.baseStats?.hp || 80) + 31) * target.level) / 100 + target.level + 10);

  let expectedPct = rawHpRatio * 100 * stab * eff * weatherMult * burnPenalty * spreadPenalty * accFactor;

  // 先制斩杀奖励
  if ((dexMv.priority || 0) > 0 && target.hpPercent <= expectedPct * 1.05) {
    expectedPct *= 1.45;
  }

  return {
    expectedPct: Number(expectedPct.toFixed(1)),
    eff,
    reason: eff >= 2 ? `${eff}×克制打击${target.zhSpecies}` : `本系/高威力压制${target.zhSpecies}`,
  };
}

function evaluateStatusMove(
  attacker: AIBattleSnapshot['aiActive'][number],
  moveId: string,
  target: PublicVisibleOpponent,
  snap: AIBattleSnapshot,
): { expectedPct: number; eff: number; reason: string } {
  // 守住博弈（双打或残血试探）
  if (['protect', 'detect', 'spikyshield', 'kingsshield'].includes(moveId)) {
    if (snap.isDoubles && attacker.hpPercent < 55 && Math.random() < 0.42) {
      return { expectedPct: 68, eff: 1, reason: `残血开启【${getMoveZh(moveId)}】规避集火` };
    }
    return { expectedPct: 8, eff: 1, reason: '暂无需守住' };
  }

  // 回复类招式
  if (['recover', 'roost', 'slackoff', 'milkdrink', 'softboiled', 'moonlight', 'synthesis', 'shoreup'].includes(moveId)) {
    if (attacker.hpPercent <= 48) {
      return { expectedPct: 82, eff: 1, reason: `血线偏低，使用【${getMoveZh(moveId)}】稳住阵脚` };
    }
    return { expectedPct: 5, eff: 1, reason: '血量健康无需回复' };
  }

  // 强化类招式（剑舞/龙舞/诡计/冥想/蝶舞）
  if (['swordsdance', 'dragondance', 'nastyplot', 'calmmind', 'quiverdance', 'bulkup', 'shellsmash', 'victorydance'].includes(moveId)) {
    const totalBoosts = Object.values(attacker.boosts).reduce((a, b) => a + Math.max(0, b), 0);
    if (attacker.hpPercent >= 72 && totalBoosts < 2) {
      return { expectedPct: 74, eff: 1, reason: `血量健康，趁机【${getMoveZh(moveId)}】强化推队` };
    }
    return { expectedPct: 14, eff: 1, reason: '已完成强化或血线不安全' };
  }

  // 顺风 / 戏法空间 / 隐形岩
  if (moveId === 'tailwind' && !snap.aiTailwind) {
    return { expectedPct: 78, eff: 1, reason: '开启【顺风】抢占全场速度线' };
  }
  if (moveId === 'trickroom' && !snap.trickRoomActive && attacker.stats.spe < 95) {
    return { expectedPct: 84, eff: 1, reason: '低速阵容展开【戏法空间】反转先后手' };
  }
  if (moveId === 'stealthrock' && !snap.playerSideHazards.includes('Stealth Rock') && snap.playerAliveCount >= 2) {
    return { expectedPct: 66, eff: 1, reason: '撒下【隐形岩】消耗敌方后排血皮与气势披带' };
  }

  // 催眠 / 鬼火 / 电磁波 / 剧毒
  if (['spore', 'sleeppowder', 'yawn', 'willowisp', 'thunderwave', 'toxic', 'glare'].includes(moveId)) {
    if (!target.status) {
      if (moveId === 'willowisp' && !target.types.includes('Fire')) {
        return { expectedPct: 64, eff: 1, reason: `用【鬼火】废除${target.zhSpecies}物攻能力` };
      }
      if (moveId === 'thunderwave' && !target.types.includes('Electric') && !target.types.includes('Ground')) {
        return { expectedPct: 62, eff: 1, reason: `用【电磁波】控住${target.zhSpecies}速度` };
      }
      if (['spore', 'sleeppowder'].includes(moveId) && !target.types.includes('Grass')) {
        return { expectedPct: 76, eff: 1, reason: `以【${getMoveZh(moveId)}】催眠限制核心输出` };
      }
      if (moveId === 'yawn') {
        return { expectedPct: 70, eff: 1, reason: `施放【哈欠】逼迫敌方轮换` };
      }
      if (moveId === 'toxic' && !target.types.includes('Poison') && !target.types.includes('Steel')) {
        return { expectedPct: 64, eff: 1, reason: `施加【剧毒】瓦解耐久核心` };
      }
      if (moveId === 'glare' && !target.types.includes('Electric')) {
        return { expectedPct: 64, eff: 1, reason: `使用【大蛇瞪眼】麻痹控速` };
      }
    }
    return { expectedPct: 4, eff: 0, reason: '目标已有状态或免疫' };
  }

  return { expectedPct: 24, eff: 1, reason: `施放战术变化技【${getMoveZh(moveId)}】` };
}

function buildSpeechBubble(
  personality: TrainerPersonality,
  isSuperEffective: boolean,
  isSwitching: boolean,
  isTera: boolean,
  turn: number,
): string {
  if (personality === 'wild') {
    return isSuperEffective ? '吼——！！（充满敌意地扑了上来！）' : '咕噜噜……！（警惕地盯着这边！）';
  }
  if (isTera) {
    return personality === 'champion'
      ? '绽放吧，这就是逆转战局的太晶光辉！'
      : '王牌太晶化启动——这一击定胜负！';
  }
  if (isSwitching) {
    return personality === 'scientist'
      ? '根据属性矩阵推演，此处轮转联防最优。'
      : '这招早被我看穿了，换人联防！';
  }
  if (turn <= 1) {
    const openers: Record<TrainerPersonality, string> = {
      rival: '别以为能轻易突破我的防线，先接下这招！',
      champion: '让我看看你与宝可梦之间的羁绊能走到哪一步吧。',
      scientist: '战斗参数采集完毕，开始执行最优压制方案。',
      boss: '踏入此地之人，就用全力来证明你的器量吧！',
      wild: '吼——！',
    };
    return openers[personality];
  }
  if (isSuperEffective) {
    return personality === 'boss' ? '破绽百出！承受这致命一击吧！' : '抓住属性弱点了，一鼓作气进攻！';
  }
  return personality === 'scientist'
    ? '维持血线差与先手权，稳步推进。'
    : '稳扎稳打，胜利的天平正在向我倾斜！';
}

/**
 * 高强度本地启发式战术 AI（支持单打 3v3、双打 4v4 协同与肉鸽精英/Boss 决策，零延迟离线可用）
 */
export class HeuristicTacticalAI {
  decide(
    engine: BattleEngine,
    p2Req: ParsedSideRequest,
    personality: TrainerPersonality = 'rival',
  ): AIDecisionResult {
    const snap = buildAISnapshot(engine, p2Req);

    // 1. 赛前 Team Preview 选出策略：挑选种族与克制覆盖最均衡的首发与后排
    if (snap.isTeamPreview) {
      const total = p2Req.side.pokemon.length;
      const pickCount = p2Req.maxChosenTeamSize || total;
      const scored = p2Req.side.pokemon.map((mon) => {
        const sp = Dex.species.get(mon.species);
        let score = (sp.bst || 500) * 0.1;
        for (const opp of p2Req.side.pokemon) {
          void opp;
        }
        for (const pBall of engine.field.partyBalls.p1) {
          const pSp = Dex.species.get(pBall.species);
          if (pSp.exists && sp.exists) {
            for (const t of sp.types) {
              if (getTypeEffectiveness(t, pSp.types) >= 2) score += 18;
            }
          }
        }
        return { index: mon.index, zh: mon.zhName, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const order = scored
        .slice(0, pickCount)
        .map((x) => x.index)
        .join('');
      const leadZh = scored[0]?.zh || '王牌';
      return {
        choiceString: engine.validateOrFallbackChoice(p2Req, `team ${order}`),
        thoughtSummary: `赛前阵容博弈：针对我方暴露阵容，选出【${leadZh}】首发抢占对位优势。`,
        speechBubble: '阵容选定完毕，来一场痛快的正统较量吧！',
        source: 'heuristic',
      };
    }

    // 2. 濒死补位 Force Switch：选择对当前场上对手克制分最高且抗性最优的后排
    if (snap.isForceSwitch) {
      const usedIdx = new Set<number>();
      const chosenParts: string[] = [];
      const reasons: string[] = [];
      const flags = p2Req.forceSwitch || [true];

      for (let slotIdx = 0; slotIdx < flags.length; slotIdx++) {
        if (!flags[slotIdx]) {
          chosenParts.push('pass');
          continue;
        }
        const candidates = snap.aiBench.filter((b) => !usedIdx.has(b.index));
        if (candidates.length === 0) {
          chosenParts.push('pass');
          continue;
        }
        let best = candidates[0];
        let bestScore = -999;

        for (const cand of candidates) {
          const sp = Dex.species.get(cand.species);
          let sc = cand.hpPercent * 0.4;
          for (const foe of snap.playerActive) {
            for (const mvId of cand.moves) {
              const mv = Dex.moves.get(mvId);
              if (mv.exists && mv.category !== 'Status') {
                const eff = getTypeEffectiveness(mv.type, foe.types);
                sc += eff * 22;
              }
            }
            for (const foeType of foe.types) {
              const taken = getTypeEffectiveness(foeType, sp.types);
              if (taken >= 2) sc -= 24;
              else if (taken <= 0.5) sc += 16;
            }
          }
          if (sc > bestScore) {
            bestScore = sc;
            best = cand;
          }
        }
        usedIdx.add(best.index);
        chosenParts.push(`switch ${best.index}`);
        reasons.push(`派上【${best.zhName}】针对场上弱点反制`);
      }

      return {
        choiceString: engine.validateOrFallbackChoice(p2Req, chosenParts.join(', ')),
        thoughtSummary: reasons.join('；') || '轮转后排生力军返场控局。',
        speechBubble: personality === 'wild' ? '吼——！' : '还没结束呢，接下来轮到这孩子上场！',
        source: 'heuristic',
      };
    }

    // 3. 常规回合单/双打战术评估
    const chosenActions: string[] = [];
    const slotReasons: string[] = [];
    const usedSwitchIndices = new Set<number>();
    let usedTeraInTurn = false;
    let anySuperEffective = false;
    let anySwitch = false;
    let anyTera = false;
    const focusedLowHpSlot = new Set<string>();

    for (let i = 0; i < snap.aiActive.length; i++) {
      const actor = snap.aiActive[i];
      const legalList = snap.legalChoicesBySlot[i] || ['default'];
      let bestChoice = legalList[0] || 'default';
      let bestScore = -999;
      let bestReason = `${actor.zhName}稳健出招`;
      let bestIsSuper = false;
      let bestIsTera = false;

      for (const mv of actor.moves) {
        if (mv.disabled) continue;

        const targetsToEval: Array<{ foe: PublicVisibleOpponent; suffix: string }> = [];
        const needsTarget =
          snap.isDoubles && ['normal', 'any', 'adjacentFoe'].includes(mv.target);

        if (needsTarget) {
          const p1a = snap.playerActive.find((p) => p.slot === 'p1a');
          const p1b = snap.playerActive.find((p) => p.slot === 'p1b');
          if (p1a) targetsToEval.push({ foe: p1a, suffix: ' +1' });
          if (p1b) targetsToEval.push({ foe: p1b, suffix: ' +2' });
          if (targetsToEval.length === 0 && snap.playerActive[0]) {
            targetsToEval.push({ foe: snap.playerActive[0], suffix: ' +1' });
          }
        } else if (snap.playerActive[0]) {
          targetsToEval.push({ foe: snap.playerActive[0], suffix: '' });
        }

        // 双打防误伤队友检查（如地震/浊流/放电）
        let hitsAllyPenalty = 0;
        if (snap.isDoubles && mv.target === 'allAdjacent' && snap.aiActive.length > 1) {
          const ally = snap.aiActive[i === 0 ? 1 : 0];
          if (ally) {
            const allySp = Dex.species.get(ally.species);
            const allyImmune =
              checkLikelyImmuneByAbility(mv.type, ally.species, ally.ability) ||
              getTypeEffectiveness(mv.type, allySp.types) === 0;
            if (!allyImmune) hitsAllyPenalty = 45;
          }
        }

        for (const { foe, suffix } of targetsToEval) {
          const baseEval = estimateMoveDamageScore(actor, mv, foe, snap);
          let score = baseEval.expectedPct - hitsAllyPenalty;

          // 斩杀加权与防双打溢出集火
          if (mv.category !== 'Status' && baseEval.expectedPct >= foe.hpPercent) {
            score += focusedLowHpSlot.has(foe.slot) ? -25 : 36;
          }

          const rawCmd = `move ${mv.index}${suffix}`;
          if (legalList.includes(rawCmd) && score > bestScore) {
            bestScore = score;
            bestChoice = rawCmd;
            bestReason = `${actor.zhName}对${foe.zhSpecies}使用【${mv.zhName}】（${baseEval.reason}）`;
            bestIsSuper = baseEval.eff >= 2;
            bestIsTera = false;
          }

          // 评估是否值得交出太晶化（本回合尚未太晶，且太晶后伤害大幅跃升或脱离致命弱点）
          if (actor.canTerastallize && !usedTeraInTurn && personality !== 'wild') {
            const teraCmd = `${rawCmd} terastallize`;
            if (legalList.includes(teraCmd)) {
              const teraEval = estimateMoveDamageScore(
                actor,
                mv,
                foe,
                snap,
                actor.canTerastallize,
              );
              let defensiveBonus = 0;
              for (const ft of foe.types) {
                const curWeak = getTypeEffectiveness(ft, Dex.species.get(actor.species).types);
                const newWeak = getTypeEffectiveness(ft, [actor.canTerastallize]);
                if (curWeak >= 2 && newWeak <= 1) defensiveBonus += 24;
              }
              const teraScore = teraEval.expectedPct + defensiveBonus - hitsAllyPenalty - 12;
              if (teraScore > bestScore + 10) {
                bestScore = teraScore;
                bestChoice = teraCmd;
                bestReason = `${actor.zhName}果断太晶【${actor.canTerastallize}】并施放【${mv.zhName}】抢节奏`;
                bestIsSuper = teraEval.eff >= 2;
                bestIsTera = true;
              }
            }
          }
        }
      }

      // 评估劣势对位主动轮转联防（当最高招式得分很低，且我方被场上对手克制时）
      if (bestScore < 42 && snap.aiBench.length > 0 && personality !== 'wild') {
        const actorSp = Dex.species.get(actor.species);
        const threatened = snap.playerActive.some((foe) =>
          foe.types.some((ft) => getTypeEffectiveness(ft, actorSp.types) >= 2),
        );
        if (threatened) {
          for (const benchMon of snap.aiBench) {
            if (usedSwitchIndices.has(benchMon.index) || benchMon.hpPercent < 45) continue;
            const swCmd = `switch ${benchMon.index}`;
            if (!legalList.includes(swCmd)) continue;
            const bSp = Dex.species.get(benchMon.species);
            const resistsAll = snap.playerActive.every((foe) =>
              foe.types.every((ft) => getTypeEffectiveness(ft, bSp.types) <= 0.5),
            );
            if (resistsAll) {
              bestChoice = swCmd;
              bestReason = `${actor.zhName}对位受制，轮转抗性优秀的【${benchMon.zhName}】中转联防`;
              usedSwitchIndices.add(benchMon.index);
              anySwitch = true;
              bestIsTera = false;
              break;
            }
          }
        }
      }

      if (bestIsTera) {
        usedTeraInTurn = true;
        anyTera = true;
      }
      if (bestIsSuper) {
        anySuperEffective = true;
      }
      if (bestChoice.includes('+1')) focusedLowHpSlot.add('p1a');
      if (bestChoice.includes('+2')) focusedLowHpSlot.add('p1b');

      chosenActions.push(bestChoice);
      slotReasons.push(bestReason);
    }

    const validated = engine.validateOrFallbackChoice(p2Req, chosenActions.join(', '));
    const speedNote = snap.trickRoomActive
      ? '（戏法空间生效中）'
      : snap.aiTailwind
        ? '（我方顺风控速）'
        : '';

    return {
      choiceString: validated,
      thoughtSummary: `${slotReasons.join('；')}${speedNote}`,
      speechBubble: buildSpeechBubble(
        personality,
        anySuperEffective,
        anySwitch,
        anyTera,
        snap.turn,
      ),
      source: 'heuristic',
    };
  }
}

export function formatQuickEnemyPreviewName(species: string): string {
  return getSpeciesZh(species);
}
