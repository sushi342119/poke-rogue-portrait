import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HeuristicTacticalAI } from '../src/ai/HeuristicTacticalAI';
import { LLMTacticalAI } from '../src/ai/LLMTacticalAI';
import { buildAISnapshot } from '../src/ai/BattleSnapshot';
import { getWaveLevelCap } from '../src/config/constants';
import { importShowdownPaste } from '../src/config/presets';
import { BattleEngine } from '../src/core/BattleEngine';
import { EggGachaSystem, getSpeciesEggMoves } from '../src/core/EggGachaSystem';
import { RogueRunManager } from '../src/core/RogueRunManager';
import { SaveStorage } from '../src/core/SaveStorage';
import {
  calcSpeedTierRange,
  getAbilityZh,
  getItemZh,
  getMoveZh,
  getSpeciesZh,
  getTypeEffectiveness,
  setRogueDexDatabase,
  type RogueDexDatabase,
} from '../src/data/dexRegistry';

const SAMPLE_TEAM_A = `
Charizard @ Sitrus Berry
Ability: Blaze
Level: 50
Tera Type: Fire
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Dragon Pulse
- Protect

Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Swords Dance
`.trim();

const SAMPLE_TEAM_B = `
Gyarados @ Leftovers
Ability: Intimidate
Level: 50
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Waterfall
- Ice Fang
- Dragon Dance
- Protect

Gardevoir @ Focus Sash
Ability: Trace
Level: 50
Tera Type: Fairy
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Moonblast
- Psychic
- Thunderbolt
- Mystical Fire
`.trim();

beforeAll(() => {
  const raw = readFileSync(
    resolve(__dirname, '../public/data/rogue-dex-zh.json'),
    'utf-8',
  );
  const parsed = JSON.parse(raw) as RogueDexDatabase;
  setRogueDexDatabase(parsed);
});

describe('1. 全世代中文图鉴与数值注册表 (dexRegistry)', () => {
  it('成功加载全部 1,025 种宝可梦及简中名称、属性克制与速度线', () => {
    expect(getSpeciesZh('Charmander')).toBe('小火龙');
    expect(getSpeciesZh('Eternatus')).toBe('无极汰那');
    expect(getMoveZh('Thunderbolt')).toBe('十万伏特');
    expect(getAbilityZh('Intimidate')).toBe('威吓');
    expect(getItemZh('Focus Sash')).toBe('气势披带');

    expect(getTypeEffectiveness('Ice', ['Dragon', 'Ground'])).toBe(4);
    expect(getTypeEffectiveness('Electric', ['Ground'])).toBe(0);
    expect(getTypeEffectiveness('Fire', ['Water', 'Rock'])).toBe(0.25);

    const spe = calcSpeedTierRange('Garchomp', 50);
    expect(spe.baseSpe).toBe(102);
    expect(spe.maxSpe).toBe(169);
    expect(spe.scarfSpe).toBe(253);
  });
});

describe('2. Showdown 单打 / 野生双打 2v2 对战引擎、Boss 多段护盾与双栈 AI', () => {
  it('完整跑通肉鸽单打与诱饵 2v2 双打遭遇（含战争迷雾校验与太晶化）', async () => {
    const p1Two = importShowdownPaste(SAMPLE_TEAM_A, true);
    const p2Two = importShowdownPaste(SAMPLE_TEAM_B, true);
    const ai = new HeuristicTacticalAI();

    const engine = new BattleEngine({
      isDoubles: true,
      teamPreview: false,
      p1Name: 'Player',
      p2Name: 'Wild',
      p1Team: p1Two,
      p2Team: p2Two,
    });

    await engine.start();
    expect(engine.field.turn).toBe(1);
    expect(engine.slots.get('p1a')).toBeDefined();
    expect(engine.slots.get('p2b')).toBeDefined();

    // 验证 AI 快照严格战争迷雾
    const p2ReqTurn1 = engine.getP2Request()!;
    const snap = buildAISnapshot(engine, p2ReqTurn1);
    expect(snap.playerActive.length).toBe(2);
    expect(snap.playerActive[0].revealedMoves.length).toBe(0);

    let safety = 0;
    while (!engine.isEnded() && safety < 80) {
      safety++;
      const r1 = engine.getP1Request();
      const r2 = engine.getP2Request();
      const c1 = r1 && !r1.wait ? ai.decide(engine, r1, 'champion').choiceString : null;
      const c2 = r2 && !r2.wait ? ai.decide(engine, r2, 'wild').choiceString : null;
      await engine.submitStep(c1, c2);
    }

    expect(engine.isEnded()).toBe(true);
    expect(['p1', 'p2', 'tie']).toContain(engine.getWinner());
  });

  it('PokéRogue 关底 Boss 多段护盾拦截高额爆发伤害，且投球失败消耗玩家回合不扣 PP', async () => {
    const p1BossKiller = importShowdownPaste(
      `
Charizard @ Choice Specs
Ability: Blaze
Level: 80
Tera Type: Fire
EVs: 252 SpA / 252 Spe
Modest Nature
- Flamethrower
    `.trim(),
      false,
    );
    const p2Boss = importShowdownPaste(
      `
Venusaur @ Sitrus Berry
Ability: Overgrow
Level: 20
EVs: 252 HP
Bold Nature
- Tackle
    `.trim(),
      false,
    );

    const engine = new BattleEngine({
      isDoubles: false,
      teamPreview: false,
      p1Name: 'Player',
      p2Name: 'Boss',
      p1Team: p1BossKiller,
      p2Team: p2Boss,
      p2BossShields: 2,
    });

    await engine.start();

    const beforePp = engine.getP1Request()!.active![0]!.moves[0].pp;
    await engine.consumePlayerTurnForBallThrow('move 1');
    expect(engine.field.turn).toBe(2);
    expect(engine.getP1Request()!.active![0]!.moves[0].pp).toBe(beforePp);

    const events = await engine.submitChoices('move 1', 'move 1');
    const shieldEvent = events.find((e) => e.kind === 'boss-shield-break');
    expect(shieldEvent).toBeDefined();
    expect(engine.isEnded()).toBe(false);
    expect(engine.slots.get('p2a')!.hpPercent).toBeGreaterThanOrEqual(60);
  });

  it('外部大模型返回非法指令或请求超时异常时，100% 安全回退至合法动作', async () => {
    const p1 = importShowdownPaste(SAMPLE_TEAM_A, true).slice(0, 1);
    const p2 = importShowdownPaste(SAMPLE_TEAM_B, true).slice(0, 1);
    const engine = new BattleEngine({
      isDoubles: false,
      teamPreview: false,
      p1Name: 'P1',
      p2Name: 'P2',
      p1Team: p1,
      p2Team: p2,
    });
    await engine.start();
    const p2Req = engine.getP2Request()!;

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                choices: ['switch 99'],
                thoughtSummary: '测试非法换人拦截',
                speechBubble: '看招！',
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const llm = new LLMTacticalAI();
    const dec = await llm.decide(
      engine,
      p2Req,
      {
        enabled: true,
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        timeoutMs: 3000,
      },
      'champion',
    );

    const legal = BattleEngine.enumerateLegalChoicesForSlot(p2Req, 0, new Set());
    expect(legal).toContain(dec.choiceString);

    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));
    const fbDec = await llm.decide(
      engine,
      p2Req,
      {
        enabled: true,
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        timeoutMs: 3000,
      },
      'champion',
    );
    expect(fbDec.source).toBe('llm-fallback');
    expect(legal).toContain(fbDec.choiceString);

    vi.unstubAllGlobals();
  });
});

describe('3. 纯肉鸽刷塔深化系统：经典200层/无尽双模式、群系分支、锁品质与扭蛋孵蛋糖果养成', () => {
  it('验证经典200层里程碑节点（宿敌、道馆主、天王冠军与第200层无极汰那5盾决战及通关结算）', () => {
    const rogue = new RogueRunManager();
    const run = rogue.startNewRun(['charmander', 'bulbasaur'], 'classic');
    expect(run.mode).toBe('classic');
    expect(rogue.getBudgetLimit('classic')).toBe(10);
    expect(rogue.getBudgetLimit('endless')).toBe(15);
    expect(getWaveLevelCap(200)).toBe(200);

    // 第 8 波固定触发宿敌战
    run.wave = 8;
    const rivalEnc = rogue.generateCurrentWaveEncounter();
    expect(rivalEnc.kind).toBe('rival');
    expect(rivalEnc.canCatch).toBe(false);

    // 第 20 波固定触发群系道馆主战
    run.wave = 20;
    const gymEnc = rogue.generateCurrentWaveEncounter();
    expect(gymEnc.kind).toBe('gym');

    // 第 10 波关底通关触发群系分支（无地图 2 路线，有城镇地图 3 路线）
    run.wave = 10;
    const bossEnc = rogue.generateCurrentWaveEncounter();
    expect(bossEnc.kind).toBe('boss');
    const persist = run.party.map((m) => ({
      hp: m.hp,
      maxhp: m.maxhp,
      fainted: false,
      status: '' as const,
      movePp: m.movePp,
    }));
    const sumNoMap = rogue.completeWaveVictory(persist, bossEnc);
    expect(sumNoMap.biomeChoices?.length).toBe(2);

    run.wave = 30;
    run.relics.townMap = 1;
    const sumWithMap = rogue.completeWaveVictory(persist, bossEnc);
    expect(sumWithMap.biomeChoices?.length).toBe(3);

    // 锁定胶囊保品质刷新校验
    run.relics.lockCapsule = 1;
    const lockRes = rogue.toggleRarityLock();
    expect(lockRes.ok).toBe(true);
    expect(lockRes.locked).toBe(true);
    run.money = 50000;
    const rerolled = rogue.rollFreeRewardDraft(true, ['mb', 'ub', 'gb']);
    expect(rerolled.items[0].tier).toBe('mb');
    expect(['ub', 'mb']).toContain(rerolled.items[1].tier);

    // 第 200 波终局无极汰那 5 段护盾与殿堂通关奖励黄金十连券
    run.wave = 200;
    const finalEnc = rogue.generateCurrentWaveEncounter();
    expect(finalEnc.kind).toBe('final-boss');
    expect(finalEnc.bossShields).toBe(5);
    expect(finalEnc.enemyTeam[0].species).toBe('Eternatus');

    const beforePremium = SaveStorage.getMeta().vouchers.premium;
    const clearSum = rogue.completeWaveVictory(persist, finalEnc);
    expect(clearSum.classicCleared).toBe(true);
    expect(SaveStorage.getMeta().classicClears).toBeGreaterThanOrEqual(1);
    expect(SaveStorage.getMeta().vouchers.premium).toBe(beforePremium + 1);
  });

  it('验证三大 UP 扭蛋机保底抽蛋、破壳领悟蛋招式与糖果永久减费/6V觉醒养成', () => {
    const eggMoves = getSpeciesEggMoves('charmander');
    expect(eggMoves.length).toBe(4);
    expect(eggMoves).toContain('Eruption');

    // 发放五连精良券并抽取 5 枚彩蛋（保底含 rare 及以上）
    SaveStorage.addVoucher('plus', 1);
    const pullRes = EggGachaSystem.pullVoucher('move', 'plus');
    expect(pullRes.ok).toBe(true);
    expect(pullRes.pulledEggs.length).toBe(5);
    expect(pullRes.pulledEggs.some((e) => e.tier !== 'common')).toBe(true);

    // 推进 40 波使全部彩蛋自然破壳孵化
    const hatched = EggGachaSystem.tickEggsOnWaveClear(40);
    expect(hatched.length).toBeGreaterThanOrEqual(5);

    // 验证糖果减费与 6V 潜能觉醒直接作用于新局出战初始宠
    SaveStorage.unlockStarterAndCandy('charmander', 30, { eggMove: 'Eruption' });
    const rogue = new RogueRunManager();
    const baseCost = rogue.getEffectiveStarterCost('charmander');

    const redRes = EggGachaSystem.spendStarterCandies('charmander', 'reduce-cost');
    expect(redRes.ok).toBe(true);
    expect(rogue.getEffectiveStarterCost('charmander')).toBe(Math.max(1, baseCost - 1));

    const awkRes = EggGachaSystem.spendStarterCandies('charmander', 'awaken');
    expect(awkRes.ok).toBe(true);

    const endlessRun = rogue.startNewRun(['charmander'], 'endless');
    expect(endlessRun.mode).toBe('endless');
    expect(endlessRun.party[0].awakened).toBe(true);
    expect(endlessRun.party[0].set.ivs.spa).toBe(31);
    expect(endlessRun.party[0].set.moves).toContain('Eruption');

    // 验证网页版 ⇄ 安卓 APK 跨端存档码导出与导入恢复闭环
    const backupCode = SaveStorage.exportSaveBundle();
    expect(backupCode.startsWith('PRP2:')).toBe(true);
    SaveStorage.clearRogueRun();
    const restoreRes = SaveStorage.importSaveBundle(backupCode);
    expect(restoreRes.ok).toBe(true);
    expect(SaveStorage.getRogueRun()?.mode).toBe('endless');
    expect(SaveStorage.getMeta().starterCandies.charmander).toBeGreaterThan(0);
  });
});
