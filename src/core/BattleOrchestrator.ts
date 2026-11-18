import type { PokemonSet } from '@pkmn/sim';
import {
  STAT_LABELS_ZH,
  STATUS_LABELS_ZH,
  TYPE_THEMES,
  type BattleSlotId,
  type BiomeConfig,
} from '../config/constants';
import type { TrainerProfile } from '../config/presets';
import { audioEngine } from '../audio/AudioEngine';
import type { AIDecisionResult, TrainerPersonality } from '../ai/BattleSnapshot';
import { LLMTacticalAI } from '../ai/LLMTacticalAI';
import type { BattleScene } from '../scenes/BattleScene';
import {
  BattleEngine,
  type BattleInitOptions,
  type ParsedSideRequest,
  type VisualBattleEvent,
} from './BattleEngine';
import type { BallTier, RogueRunManager, WaveEncounterSpec } from './RogueRunManager';
import { SaveStorage } from './SaveStorage';

export type BattleModeKind = 'rogue';

export interface ActiveBattleContext {
  mode: BattleModeKind;
  isDoubles: boolean;
  titleZh: string;
  subBadgeZh: string;
  biome: BiomeConfig;
  trainer?: TrainerProfile;
  personality: TrainerPersonality;
  canCatch: boolean;
  rogueEncounter?: WaveEncounterSpec;
}

export interface BattleOrchestratorCallbacks {
  onHudSync: (engine: BattleEngine, context: ActiveBattleContext) => void;
  onLogLine: (html: string, turn: number) => void;
  onLogClear: () => void;
  onAiBannerUpdate: (info: {
    trainer?: TrainerProfile;
    speechBubble: string;
    thoughtSummary: string;
    source: 'heuristic' | 'llm' | 'llm-fallback' | 'thinking';
  }) => void;
  onRequestPlayerTurn: (
    engine: BattleEngine,
    req: ParsedSideRequest,
    context: ActiveBattleContext,
  ) => void;
  onLockControls: (reasonZh: string) => void;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
  onBattleConcluded: (result: {
    winner: 'p1' | 'p2' | 'tie';
    engine: BattleEngine;
    context: ActiveBattleContext;
    capturedSet?: PokemonSet;
  }) => void;
}

/**
 * 战斗总编排器：
 * 串联 @pkmn/sim 协议引擎、Phaser 3 像素舞台、双声道音频、双栈战术 AI（含零延迟并行预思考）与 Showdown UI
 */
export class BattleOrchestrator {
  private scene: BattleScene;
  private rogueManager: RogueRunManager;
  private callbacks: BattleOrchestratorCallbacks;
  private llmAI = new LLMTacticalAI();

  private engine: BattleEngine | null = null;
  private context: ActiveBattleContext | null = null;
  private precomputedAiPromise: Promise<AIDecisionResult> | null = null;
  private isBusy = false;
  private battleToken = 0;

  constructor(
    scene: BattleScene,
    rogueManager: RogueRunManager,
    callbacks: BattleOrchestratorCallbacks,
  ) {
    this.scene = scene;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  getEngine(): BattleEngine | null {
    return this.engine;
  }

  getContext(): ActiveBattleContext | null {
    return this.context;
  }

  setBattleSpeed(speed: 1 | 2 | 4): void {
    const prefs = SaveStorage.getPrefs();
    prefs.battleSpeed = speed;
    SaveStorage.savePrefs(prefs);
    this.scene.setSpeedMultiplier(speed);
  }

  async startBattle(initOptions: BattleInitOptions, context: ActiveBattleContext): Promise<void> {
    const token = ++this.battleToken;
    this.isBusy = true;
    this.context = context;
    this.precomputedAiPromise = null;

    await this.scene.whenReady();
    if (token !== this.battleToken) return;

    const prefs = SaveStorage.getPrefs();
    this.scene.setSpeedMultiplier(prefs.battleSpeed);
    this.scene.clearAllActors();
    this.scene.setFormation(context.isDoubles);
    this.scene.applyBiome(context.biome);

    const bgmFile = context.trainer?.bgmTrack || context.biome.showdownBgm;
    const kind = context.rogueEncounter?.kind;
    const synthTheme =
      kind === 'boss' || kind === 'final-boss' || kind === 'champion'
        ? 'boss'
        : kind === 'elite' || kind === 'gym' || kind === 'rival'
          ? 'elite'
          : context.trainer
            ? 'trainer'
            : context.biome.synthTheme;
    audioEngine.playBattleBgm(bgmFile, synthTheme);

    this.callbacks.onLogClear();
    if (context.trainer) {
      this.callbacks.onAiBannerUpdate({
        trainer: context.trainer,
        speechBubble: context.trainer.introQuote,
        thoughtSummary: '观察双方首发阵容与属性联防关系…',
        source: 'heuristic',
      });
    } else {
      this.callbacks.onAiBannerUpdate({
        trainer: undefined,
        speechBubble: context.isDoubles ? '两只野生宝可梦同时跳出来了！' : '野生的宝可梦跳出来了！',
        thoughtSummary: '野生宝可梦本能应战中',
        source: 'heuristic',
      });
    }

    this.engine = new BattleEngine(initOptions);
    this.callbacks.onHudSync(this.engine, context);
    this.callbacks.onLockControls('正在切入战场…');

    const initialEvents = await this.engine.start();
    if (token !== this.battleToken) return;

    await this.playEventQueue(initialEvents, token);
    if (token !== this.battleToken) return;

    this.isBusy = false;
    await this.advanceUntilPlayerDecision(token);
  }

  /**
   * 推进单边等待状态（如敌方濒死需单独换人补位），并在玩家行动前并行启动 AI 战争迷雾预推理
   */
  private async advanceUntilPlayerDecision(token: number): Promise<void> {
    if (!this.engine || !this.context || token !== this.battleToken) return;

    while (!this.engine.isEnded()) {
      const p1Req = this.engine.getP1Request();
      const p2Req = this.engine.getP2Request();

      if (p1Req?.wait && p2Req && !p2Req.wait) {
        this.callbacks.onLockControls('对手正在派上下一只宝可梦…');
        const aiDecision = await this.computeAiDecision(p2Req);
        if (token !== this.battleToken) return;
        this.publishAiBanner(aiDecision);
        const events = await this.engine.submitStep(null, aiDecision.choiceString);
        if (token !== this.battleToken) return;
        await this.playEventQueue(events, token);
        continue;
      }

      break;
    }

    if (!this.engine || token !== this.battleToken) return;

    if (this.engine.isEnded()) {
      const winner = this.engine.getWinner() || 'p2';
      if (winner === 'p1') {
        audioEngine.synth.playSfx('confirm');
      }
      this.callbacks.onBattleConcluded({
        winner,
        engine: this.engine,
        context: this.context,
      });
      return;
    }

    const p1Req = this.engine.getP1Request();
    const p2Req = this.engine.getP2Request();
    this.callbacks.onHudSync(this.engine, this.context);

    // 若对手本回合也需要同步决策，立即在后台并行发起严格战争迷雾推理（隐藏 LLM 延迟且绝不偷看玩家本回合输入！）
    if (p2Req && !p2Req.wait) {
      const prefs = SaveStorage.getPrefs();
      if (prefs.llm.enabled && prefs.llm.apiKey.trim() && this.context.personality !== 'wild') {
        this.callbacks.onAiBannerUpdate({
          trainer: this.context.trainer,
          speechBubble: '……（正在推演战术分支）',
          thoughtSummary: '外部大模型正在分析公开战况…',
          source: 'thinking',
        });
      }
      this.precomputedAiPromise = this.computeAiDecision(p2Req);
    } else {
      this.precomputedAiPromise = null;
    }

    if (!p1Req) return;

    this.callbacks.onRequestPlayerTurn(this.engine, p1Req, this.context);
  }

  private async computeAiDecision(p2Req: ParsedSideRequest): Promise<AIDecisionResult> {
    if (!this.engine || !this.context) {
      return {
        choiceString: 'default',
        thoughtSummary: '',
        speechBubble: '',
        source: 'heuristic',
      };
    }
    const prefs = SaveStorage.getPrefs();
    return this.llmAI.decide(this.engine, p2Req, prefs.llm, this.context.personality);
  }

  private publishAiBanner(dec: AIDecisionResult): void {
    if (!this.context) return;
    if (!dec.speechBubble && !dec.thoughtSummary) return;
    this.callbacks.onAiBannerUpdate({
      trainer: this.context.trainer,
      speechBubble: dec.speechBubble,
      thoughtSummary: dec.thoughtSummary,
      source: dec.source,
    });
  }

  /**
   * 玩家提交指令（回合出招或换人 / 濒死补位）
   */
  async submitPlayerChoice(p1Choice: string): Promise<void> {
    if (this.isBusy || !this.engine || !this.context) return;
    const token = this.battleToken;
    this.isBusy = true;
    audioEngine.playUiSfx('confirm');
    this.callbacks.onLockControls('回合结算中…');

    try {
      const p2Req = this.engine.getP2Request();
      let p2Choice: string | undefined;

      if (p2Req && !p2Req.wait) {
        const aiDec = this.precomputedAiPromise
          ? await this.precomputedAiPromise
          : await this.computeAiDecision(p2Req);
        if (token !== this.battleToken) return;
        this.publishAiBanner(aiDec);
        p2Choice = aiDec.choiceString;
      }
      this.precomputedAiPromise = null;

      const events = await this.engine.submitChoices(p1Choice, p2Choice);
      if (token !== this.battleToken) return;

      await this.playEventQueue(events, token);
    } finally {
      if (token === this.battleToken) {
        this.isBusy = false;
      }
    }

    if (token === this.battleToken) {
      await this.advanceUntilPlayerDecision(token);
    }
  }

  /**
   * 肉鸽野生遭遇：投掷精灵球捕获宝可梦（支持单打及野生 2v2 双打先击倒 1 只后捕获规则）
   */
  async throwRoguePokeball(ballTier: BallTier): Promise<void> {
    if (this.isBusy || !this.engine || !this.context) return;
    const encounter = this.context.rogueEncounter;
    const slotA = this.engine.slots.get('p2a');
    const slotB = this.engine.slots.get('p2b');
    const aliveFoes = [
      slotA && !slotA.fainted ? { slot: slotA, idx: 0 } : null,
      slotB && !slotB.fainted ? { slot: slotB, idx: 1 } : null,
    ].filter((x): x is { slot: NonNullable<typeof slotA>; idx: number } => Boolean(x));

    if (!this.context.canCatch || !encounter || aliveFoes.length === 0) {
      this.callbacks.onToast('当前无法投掷精灵球！', 'warn');
      return;
    }
    if (aliveFoes.length >= 2) {
      audioEngine.playUiSfx('cancel');
      this.callbacks.onToast('野生双打需先击倒其中一只宝可梦才能瞄准投球！', 'warn');
      return;
    }

    const foeSlot = aliveFoes[0].slot;
    const foeSet = encounter.enemyTeam[aliveFoes[0].idx] || encounter.enemyTeam[0];
    const attempt = this.rogueManager.attemptPokeballThrow(
      ballTier,
      foeSet,
      foeSlot.hpPercent,
      foeSlot.status,
      foeSlot.bossShieldRemaining,
    );

    if (!attempt.ok) {
      audioEngine.playUiSfx('cancel');
      this.callbacks.onToast(attempt.reason || '无法投球', 'warn');
      return;
    }

    const token = this.battleToken;
    this.isBusy = true;
    const ballNames: Record<BallTier, string> = {
      pb: '精灵球',
      gb: '超级球',
      ub: '高级球',
      mb: '大师球',
    };
    this.callbacks.onLockControls(`投出了${ballNames[ballTier]}…`);
    this.callbacks.onLogLine(
      `<span class="log-tera">🔴 投出了 <b>${ballNames[ballTier]}</b>！（捕获率判定 ${attempt.catchPct}%）</span>`,
      this.engine.field.turn,
    );

    await this.scene.playPokeballCaptureSequence(ballTier, attempt.shakes, attempt.caught);
    if (token !== this.battleToken) return;

    if (attempt.caught) {
      this.callbacks.onLogLine(
        `<span class="log-heal">✨ 太棒了！成功收服了 <b>${foeSlot.zhSpecies}</b>！</span>`,
        this.engine.field.turn,
      );
      await this.engine.forcePlayerCaptureWin();
      this.isBusy = false;
      this.callbacks.onBattleConcluded({
        winner: 'p1',
        engine: this.engine,
        context: this.context,
        capturedSet: foeSet,
      });
      return;
    }

    // 未捕获成功：野生宝可梦挣脱并执行本回合攻击
    this.callbacks.onLogLine(
      `<span class="log-debuff">哎呀！${foeSlot.zhSpecies} 挣脱了精灵球！</span>`,
      this.engine.field.turn,
    );

    const p2Req = this.engine.getP2Request();
    const aiDec =
      this.precomputedAiPromise && p2Req
        ? await this.precomputedAiPromise
        : p2Req
          ? await this.computeAiDecision(p2Req)
          : { choiceString: 'default', thoughtSummary: '', speechBubble: '', source: 'heuristic' as const };
    this.precomputedAiPromise = null;

    const events = await this.engine.consumePlayerTurnForBallThrow(aiDec.choiceString);
    if (token !== this.battleToken) return;
    await this.playEventQueue(events, token);

    this.isBusy = false;
    await this.advanceUntilPlayerDecision(token);
  }

  /**
   * Showdown 快节奏视觉事件播放器
   */
  private async playEventQueue(events: VisualBattleEvent[], token: number): Promise<void> {
    if (!this.engine || !this.context) return;
    const speed = SaveStorage.getPrefs().battleSpeed;
    const beat = (ms: number) =>
      new Promise<void>((r) => window.setTimeout(r, Math.max(18, Math.round(ms / speed))));

    for (const ev of events) {
      if (token !== this.battleToken) return;

      switch (ev.kind) {
        case 'log': {
          this.callbacks.onLogLine(ev.html, ev.turn);
          break;
        }

        case 'turn': {
          this.callbacks.onHudSync(this.engine, this.context);
          break;
        }

        case 'switch': {
          this.callbacks.onHudSync(this.engine, this.context);
          const actor = this.scene.getActor(ev.slot);
          if (actor) {
            void actor.setPokemon(ev.state.species, {
              shiny: ev.state.shiny,
              gender: ev.state.gender,
              animateEntry: true,
            });
            actor.setStatusVisual(ev.state.status);
            const glow = ev.state.terastallized
              ? TYPE_THEMES[ev.state.terastallized]?.glow || '#8de4f7'
              : null;
            actor.setTeraGlow(glow);
            actor.setSubstitute(false);
          }
          audioEngine.playCry(ev.state.species, false);
          await beat(220);
          break;
        }

        case 'terastallize': {
          this.callbacks.onHudSync(this.engine, this.context);
          const theme = TYPE_THEMES[ev.teraType];
          this.scene.getActor(ev.slot)?.setTeraGlow(theme?.glow || '#8de4f7');
          audioEngine.playUiSfx('statUp');
          this.scene.showFloatingPopup(ev.slot, {
            text: `💎 太晶·${theme?.zh || ev.teraType}`,
            color: theme?.glow || '#8de4f7',
          });
          await beat(260);
          break;
        }

        case 'move': {
          await this.scene.playMoveVfx(
            ev.actorSlot,
            ev.targetSlots,
            ev.moveId,
            ev.effectiveness,
          );
          break;
        }

        case 'damage': {
          this.callbacks.onHudSync(this.engine, this.context);
          let subText: string | undefined;
          let color = '#ff8787';
          if (ev.effectiveness > 1) {
            subText = ev.isCrit ? '绝佳 · 暴击!' : '效果绝佳!';
            color = '#ffd43b';
          } else if (ev.effectiveness < 1) {
            subText = ev.isCrit ? '微弱 · 暴击!' : '效果不好';
            color = '#a5d8ff';
          } else if (ev.isCrit) {
            subText = '击中要害!';
            color = '#ffa94d';
          }
          this.scene.showFloatingPopup(ev.slot, {
            text: `-${Math.round(ev.deltaPercent)}%`,
            subText,
            color,
          });
          await beat(180);
          break;
        }

        case 'boss-shield-break': {
          this.callbacks.onHudSync(this.engine, this.context);
          audioEngine.playUiSfx('shieldBreak');
          this.scene.showFloatingPopup(ev.slot, {
            text: '⚡ 护盾击破!',
            subText: `${ev.boostedStatZh} +1`,
            color: '#ffe066',
          });
          await beat(260);
          break;
        }

        case 'heal': {
          this.callbacks.onHudSync(this.engine, this.context);
          audioEngine.playUiSfx('heal');
          this.scene.showFloatingPopup(ev.slot, {
            text: `+${Math.round(ev.deltaPercent)}%`,
            color: '#69db7c',
          });
          await beat(140);
          break;
        }

        case 'boost': {
          this.callbacks.onHudSync(this.engine, this.context);
          audioEngine.playUiSfx(ev.amount > 0 ? 'statUp' : 'statDown');
          const statZh = STAT_LABELS_ZH[ev.stat] || ev.stat;
          this.scene.showFloatingPopup(ev.slot, {
            text: `${statZh} ${ev.amount > 0 ? `+${ev.amount}` : ev.amount}`,
            color: ev.amount > 0 ? '#74c0fc' : '#ffa8a8',
          });
          await beat(120);
          break;
        }

        case 'status': {
          this.callbacks.onHudSync(this.engine, this.context);
          this.scene.getActor(ev.slot)?.setStatusVisual(ev.status);
          const stInfo = STATUS_LABELS_ZH[ev.status];
          this.scene.showFloatingPopup(ev.slot, {
            text: stInfo?.zh || ev.status,
            color: '#ffd8a8',
          });
          await beat(140);
          break;
        }

        case 'curestatus': {
          this.callbacks.onHudSync(this.engine, this.context);
          this.scene.getActor(ev.slot)?.setStatusVisual(undefined);
          this.scene.showFloatingPopup(ev.slot, {
            text: '异常解除',
            color: '#8ce99a',
          });
          break;
        }

        case 'volatile': {
          this.callbacks.onHudSync(this.engine, this.context);
          if (ev.volatile.toLowerCase() === 'substitute') {
            this.scene.getActor(ev.slot)?.setSubstitute(ev.started);
          }
          break;
        }

        case 'ability': {
          this.callbacks.onHudSync(this.engine, this.context);
          this.scene.showFloatingPopup(ev.slot, {
            text: `[特性] ${ev.abilityZh}`,
            color: '#ffe066',
          });
          await beat(140);
          break;
        }

        case 'item': {
          this.callbacks.onHudSync(this.engine, this.context);
          this.scene.showFloatingPopup(ev.slot, {
            text: `${ev.consumed ? '消耗' : '道具'}: ${ev.itemZh}`,
            color: '#d0bfff',
          });
          break;
        }

        case 'weather': {
          this.callbacks.onHudSync(this.engine, this.context);
          this.scene.setWeather(ev.weather);
          break;
        }

        case 'immune': {
          this.scene.showFloatingPopup(ev.slot, {
            text: '免疫 (0×)',
            color: '#ced4da',
          });
          await beat(140);
          break;
        }

        case 'miss': {
          this.scene.showFloatingPopup(ev.slot, {
            text: '未命中',
            color: '#ced4da',
          });
          await beat(140);
          break;
        }

        case 'faint': {
          this.callbacks.onHudSync(this.engine, this.context);
          audioEngine.playCry(ev.species, true);
          audioEngine.playLocalSe('faint.wav', 'faint');
          await this.scene.getActor(ev.slot)?.playFaint();
          break;
        }

        case 'win': {
          this.callbacks.onHudSync(this.engine, this.context);
          break;
        }
      }
    }
  }

  abortBattle(): void {
    this.battleToken++;
    this.isBusy = false;
    this.engine = null;
    this.context = null;
    this.scene.clearAllActors();
  }
}
