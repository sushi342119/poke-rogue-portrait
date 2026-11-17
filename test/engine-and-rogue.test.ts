import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HeuristicTacticalAI } from '../src/ai/HeuristicTacticalAI';
import { LLMTacticalAI } from '../src/ai/LLMTacticalAI';
import { buildAISnapshot } from '../src/ai/BattleSnapshot';
import { PRESET_TEAMS, importShowdownPaste } from '../src/config/presets';
import { getWaveLevelCap } from '../src/config/constants';
import { BattleEngine } from '../src/core/BattleEngine';
import { OfficialBattleManager } from '../src/core/OfficialBattleManager';
import { RogueRunManager } from '../src/core/RogueRunManager';
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
    expect(getSpeciesZh('Flutter Mane')).toBe('振翼发');
    expect(getSpeciesZh('Charizard-Mega-X')).toContain('喷火龙');
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

describe('2. Showdown 单打 3v3 / 双打 4v4 对战引擎与 AI 全程闭环', () => {
  it('完整跑通一场 Lv.50 单打 3v3（含赛前 Team Preview 6选3 与战争迷雾校验）', async () => {
    const p1Six = importShowdownPaste(PRESET_TEAMS[0].paste, true);
    const p2Six = importShowdownPaste(PRESET_TEAMS[3].paste, true);
    const ai = new HeuristicTacticalAI();

    const engine = new BattleEngine({
      isDoubles: false,
      teamPreview: true,
      pickedTeamSize: 3,
      p1Name: 'Player',
      p2Name: 'Champion',
      p1Team: p1Six,
      p2Team: p2Six,
    });

    await engine.start();
    expect(engine.getP1Request()?.teamPreview).toBe(true);

    // 提交 Team Preview
    await engine.submitChoices('team 123', 'team 123');
    expect(engine.field.turn).toBe(1);

    // 验证 AI 快照绝不泄露我方后排未登场宝可梦
    const p2ReqTurn1 = engine.getP2Request()!;
    const snap = buildAISnapshot(engine, p2ReqTurn1);
    expect(snap.playerActive.length).toBe(1);
    expect(snap.playerActive[0].revealedMoves.length).toBe(0);

    let safety = 0;
    while (!engine.isEnded() && safety < 80) {
      safety++;
      const r1 = engine.getP1Request();
      const r2 = engine.getP2Request();

      const c1 = r1 && !r1.wait ? ai.decide(engine, r1, 'champion').choiceString : null;
      const c2 = r2 && !r2.wait ? ai.decide(engine, r2, 'champion').choiceString : null;
      await engine.submitStep(c1, c2);
    }

    expect(engine.isEnded()).toBe(true);
    expect(['p1', 'p2', 'tie']).toContain(engine.getWinner());
  });

  it('完整跑通一场 Lv.50 双打 4v4（含双槽位目标指定、太晶化与濒死强制补位）', async () => {
    const p1Six = importShowdownPaste(PRESET_TEAMS[0].paste, true);
    const p2Six = importShowdownPaste(PRESET_TEAMS[2].paste, true);
    const ai = new HeuristicTacticalAI();

    const engine = new BattleEngine({
      isDoubles: true,
      teamPreview: true,
      pickedTeamSize: 4,
      p1Name: 'Player',
      p2Name: 'Rival',
      p1Team: p1Six,
      p2Team: p2Six,
    });

    await engine.start();
    await engine.submitChoices('team 1234', 'team 1234');
    expect(engine.slots.get('p1a')).toBeDefined();
    expect(engine.slots.get('p1b')).toBeDefined();
    expect(engine.slots.get('p2a')).toBeDefined();
    expect(engine.slots.get('p2b')).toBeDefined();

    let safety = 0;
    while (!engine.isEnded() && safety < 80) {
      safety++;
      const r1 = engine.getP1Request();
      const r2 = engine.getP2Request();
      const c1 = r1 && !r1.wait ? ai.decide(engine, r1, 'rival').choiceString : null;
      const c2 = r2 && !r2.wait ? ai.decide(engine, r2, 'scientist').choiceString : null;
      await engine.submitStep(c1, c2);
    }

    expect(engine.isEnded()).toBe(true);
  });

  it('PokéRogue 关底 Boss 多段护盾拦截高额爆发伤害，且投球失败时正常消耗玩家回合不扣 PP', async () => {
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

    // 1. 先测试野生投球挣脱：玩家不消耗招式 PP，敌方正常出招推进到第 2 回合
    const beforePp = engine.getP1Request()!.active![0]!.moves[0].pp;
    await engine.consumePlayerTurnForBallThrow('move 1');
    expect(engine.field.turn).toBe(2);
    expect(engine.getP1Request()!.active![0]!.moves[0].pp).toBe(beforePp);

    // 2. 测试 Lv.80 喷火龙喷射火焰轰击 Lv.20 妙蛙花：被第 1 段护盾卡在 67% HP 而不直接秒杀！
    const events = await engine.submitChoices('move 1', 'move 1');
    const shieldEvent = events.find((e) => e.kind === 'boss-shield-break');
    expect(shieldEvent).toBeDefined();
    expect(engine.isEnded()).toBe(false);
    expect(engine.slots.get('p2a')!.hpPercent).toBeGreaterThanOrEqual(60);
  });

  it('外部大模型返回非法指令或请求异常时，100% 安全回退至合法动作', async () => {
    const p1 = importShowdownPaste(PRESET_TEAMS[0].paste, true).slice(0, 1);
    const p2 = importShowdownPaste(PRESET_TEAMS[1].paste, true).slice(0, 1);
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

    // 模拟 LLM 返回不存在的 switch 99 非法动作
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

    // 模拟网络超时/500报错回退
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

describe('3. PokéRogue 无尽肉鸽爬塔与对战工厂业务闭环', () => {
  it('验证 10 费选宠、波次遭遇生成、收服概率、升级进化与双轨商店结算', () => {
    const rogue = new RogueRunManager();
    const run = rogue.startNewRun(['charmander', 'bulbasaur']);
    expect(run.party.length).toBe(2);
    expect(run.wave).toBe(1);
    expect(getWaveLevelCap(1)).toBe(8);
    expect(getWaveLevelCap(11)).toBe(16);

    // 野生遭遇支持收服；未破盾 Boss 捕获率强制为 0%，破盾后大师球 100%
    const enc1 = rogue.generateCurrentWaveEncounter();
    expect(enc1.kind).toBe('wild');
    expect(enc1.canCatch).toBe(true);
    expect(rogue.estimateCatchProbability('mb', 'Pikachu', 50, '', 2)).toBe(0);
    expect(rogue.estimateCatchProbability('mb', 'Pikachu', 50, '', 0)).toBe(100);

    // 推进到第 11 波（上限 Lv.16），验证小火龙升至 Lv.16 自动进化为火恐龙
    run.wave = 11;
    run.party[0].set.level = 15;
    const highExpEncounter = {
      ...enc1,
      wave: 11,
      kind: 'elite' as const,
      enemyTeam: [{ ...enc1.enemyTeam[0], species: 'Blissey', level: 25 }],
    };
    const summary = rogue.completeWaveVictory(
      run.party.map((m) => ({
        hp: m.hp,
        maxhp: m.maxhp,
        fainted: false,
        status: '',
        movePp: m.movePp,
      })),
      highExpEncounter,
    );
    expect(summary.evolutions.some((e) => e.toSpecies === 'Charmeleon')).toBe(true);
    expect(run.party[0].set.species).toBe('Charmeleon');

    // 验证免费战利品三选一与 5 波强化药剂推进下一波
    const draft = rogue.rollFreeRewardDraft(false);
    expect(draft.items.length).toBe(3);
    const adv = rogue.claimRewardAndAdvance(draft.items[0], run.party[0].uid);
    expect(adv.ok).toBe(true);
    expect(rogue.getRun()!.wave).toBe(12);
  });

  it('验证对战工厂随机竞技池选秀与战后 1 换 1 缴获机制', () => {
    const official = new OfficialBattleManager();
    const session = official.startFactorySession(true);
    expect(session.draftPool.length).toBe(8);

    const locked = official.lockFactoryDraft([0, 1, 2, 3]);
    expect(locked.length).toBe(4);

    const { team: oppTeam } = official.prepareNextFactoryOpponent();
    expect(oppTeam.length).toBe(4);

    const targetOppSpecies = oppTeam[0].species;
    official.recordFactoryResult(true);
    official.swapFactoryMember(0, 0);
    expect(official.getFactorySession()!.playerTeam[0].species).toBe(targetOppSpecies);
  });
});
