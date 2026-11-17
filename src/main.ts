import Phaser from 'phaser';
import './styles/main.css';
import type { PokemonSet } from '@pkmn/sim';
import {
  BIOMES,
  OFFICIAL_ARENA,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  getWaveLevelCap,
} from './config/constants';
import { audioEngine } from './audio/AudioEngine';
import { BattleOrchestrator } from './core/BattleOrchestrator';
import { OfficialBattleManager } from './core/OfficialBattleManager';
import { RogueRunManager } from './core/RogueRunManager';
import { SaveStorage } from './core/SaveStorage';
import { loadRogueDex } from './data/dexRegistry';
import { BattleScene } from './scenes/BattleScene';
import { CommandDeckUI } from './ui/CommandDeckUI';
import { MainMenuAndSettings } from './ui/MainMenuAndSettings';
import { RogueShopUI } from './ui/RogueShopUI';
import { ShowdownHUD } from './ui/ShowdownHUD';
import { TeambuilderUI } from './ui/TeambuilderUI';

function showToast(modalLayer: HTMLElement, text: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
  const old = modalLayer.querySelector('.app-toast');
  old?.remove();
  const el = document.createElement('div');
  el.className = `app-toast ${tone}`;
  el.textContent = text;
  modalLayer.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, 2400);
}

async function bootstrapApp(): Promise<void> {
  const hudRoot = document.getElementById('stage-hud-layer')!;
  const deckRoot = document.getElementById('command-deck')!;
  const screenRoot = document.getElementById('screen-layer')!;
  const modalRoot = document.getElementById('modal-layer')!;

  deckRoot.innerHTML = `<div class="deck-waiting"><span class="deck-spinner"></span><span>正在加载 1025 全世代中文图鉴与像素舞台…</span></div>`;

  // 1. 加载全图鉴中文与肉鸽数值数据库
  await loadRogueDex('./data/rogue-dex-zh.json');

  // 2. 初始化用户偏好与音频状态
  const initPrefs = SaveStorage.getPrefs();
  audioEngine.setBgmMode(initPrefs.bgmMode);
  audioEngine.setSfxMuted(initPrefs.sfxMuted);

  // 3. 启动 Phaser 3 像素战斗舞台 (270×256 最近邻整数风格)
  const battleScene = new BattleScene();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'phaser-stage',
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: '#1b2836',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [battleScene],
  });

  await battleScene.whenReady();

  // 4. 初始化领域管理器
  const rogueManager = new RogueRunManager();
  const officialManager = new OfficialBattleManager();

  let lastFreeTeam: PokemonSet[] = [];
  let lastFreeIsDoubles = false;

  const showMenuStageShowcase = async () => {
    hud.setVisible(false);
    battleScene.setFormation(false);
    battleScene.applyBiome(BIOMES[0]);
    void battleScene.getActor('p1a')?.setPokemon('Charizard', { animateEntry: true });
    void battleScene.getActor('p2a')?.setPokemon('Garchomp', { animateEntry: true });
    audioEngine.playMenuBgm();
  };

  // 5. 初始化 UI 组件群
  const hud = new ShowdownHUD(hudRoot, modalRoot, {
    onCycleSpeed: (nextSpeed) => {
      orchestrator.setBattleSpeed(nextSpeed);
    },
    onOpenSettings: () => {
      menuUI.openSettingsModal();
    },
    onExitToMenu: () => {
      orchestrator.abortBattle();
      shopUI.hide();
      teambuilderUI.hide();
      void showMenuStageShowcase();
      menuUI.openMainMenu();
    },
  });

  battleScene.setOnSlotTapped((slot) => {
    hud.openScoutPopover(slot);
  });

  const commandDeck = new CommandDeckUI(deckRoot, rogueManager, {
    onSubmitChoice: (choice) => {
      void orchestrator.submitPlayerChoice(choice);
    },
    onThrowPokeball: (ball) => {
      void orchestrator.throwRoguePokeball(ball);
    },
  });

  const shopUI = new RogueShopUI(screenRoot, modalRoot, rogueManager, {
    onToast: (msg, tone) => showToast(modalRoot, msg, tone),
    onPlayEvolution: async (toSpecies, shiny) => {
      await battleScene.playEvolutionMorph('p1a', toSpecies, shiny);
    },
    onProceedNextWave: () => {
      void launchCurrentRogueWave();
    },
    onExitToMenu: () => {
      orchestrator.abortBattle();
      void showMenuStageShowcase();
      menuUI.openMainMenu();
    },
  });

  const teambuilderUI = new TeambuilderUI(
    screenRoot,
    modalRoot,
    officialManager,
    rogueManager,
    {
      onBackToMenu: () => {
        void showMenuStageShowcase();
        menuUI.openMainMenu();
      },
      onStartOfficialFreeBattle: (team, isDoubles) => {
        lastFreeTeam = team;
        lastFreeIsDoubles = isDoubles;
        void launchOfficialFreeBattle(team, isDoubles);
      },
      onStartFactoryBattle: () => {
        void launchFactoryBattle();
      },
      onSubmitTeamPreview: (choice) => {
        void orchestrator.submitPlayerChoice(choice);
      },
      onStartNewRogueRun: (starterIds) => {
        rogueManager.startNewRun(starterIds);
        void launchCurrentRogueWave();
      },
      onToast: (msg, tone) => showToast(modalRoot, msg, tone),
    },
  );

  const menuUI = new MainMenuAndSettings(screenRoot, modalRoot, rogueManager, {
    onResumeRogueRun: () => {
      const saved = rogueManager.getRun();
      if (saved?.inShopPhase) {
        hud.setVisible(false);
        shopUI.openSavedShopIfInPhase();
      } else {
        void launchCurrentRogueWave();
      }
    },
    onOpenRogueStarterSelect: () => {
      teambuilderUI.openRogueStarterSelect();
    },
    onOpenOfficialFree: () => {
      teambuilderUI.openOfficialFreeBuilder(lastFreeIsDoubles);
    },
    onOpenBattleFactory: () => {
      teambuilderUI.openFactoryDraft(false);
    },
    onPrefsChanged: () => {
      hud.refreshControlBadges();
      orchestrator.setBattleSpeed(SaveStorage.getPrefs().battleSpeed);
      if (!screenRoot.classList.contains('hidden') && screenRoot.querySelector('.main-menu-overlay')) {
        menuUI.openMainMenu();
      }
    },
    onToast: (msg, tone) => showToast(modalRoot, msg, tone),
  });

  // 6. 初始化核心战斗编排器
  const orchestrator = new BattleOrchestrator(battleScene, rogueManager, {
    onHudSync: (engine, ctx) => {
      hud.sync(engine, ctx);
    },
    onLogLine: (html) => {
      hud.appendLog(html);
    },
    onLogClear: () => {
      hud.clearLogs();
    },
    onAiBannerUpdate: (info) => {
      hud.updateAiBanner(info);
    },
    onRequestTeamPreview: (_engine, req, opponentPreviewTeam, ctx) => {
      commandDeck.renderWaiting('请在赛前预览界面选择参战阵容…');
      teambuilderUI.openTeamPreview(req, opponentPreviewTeam, ctx.isDoubles);
    },
    onRequestPlayerTurn: (engine, req, ctx) => {
      screenRoot.classList.add('hidden');
      commandDeck.renderTurnRequest(engine, req, ctx);
    },
    onLockControls: (reasonZh) => {
      commandDeck.renderWaiting(reasonZh);
    },
    onToast: (msg, tone) => showToast(modalRoot, msg, tone),
    onBattleConcluded: async ({ winner, engine, context, capturedSet }) => {
      const won = winner === 'p1';

      // A. PokéRogue 无尽肉鸽模式结算
      if (context.mode === 'rogue' && context.rogueEncounter) {
        if (!won) {
          const reached = rogueManager.handleRunDefeat();
          menuUI.openBattleEndModal({
            won: false,
            title: `征程止步于 第 ${reached} 波`,
            subtitle: '全队宝可梦失去了战斗能力。收服解锁的初始同伴与糖果均已永久保留！',
            primaryLabel: '重新选宠挑战',
            onPrimary: () => teambuilderUI.openRogueStarterSelect(),
            secondaryLabel: '返回主菜单',
            onSecondary: () => {
              void showMenuStageShowcase();
              menuUI.openMainMenu();
            },
          });
          return;
        }

        const persisted = engine.extractPlayerPartyPersist();
        const summary = rogueManager.completeWaveVictory(persisted, context.rogueEncounter);
        if (capturedSet) {
          await shopUI.promptPartyFullCaptureIfNeeded(capturedSet);
        }
        await shopUI.openPostWaveShop(summary);
        return;
      }

      // B. 对战工厂连胜结算
      if (context.mode === 'official-factory') {
        const rec = officialManager.recordFactoryResult(won);
        if (won) {
          teambuilderUI.openFactorySwapAfterWin(rec.streak, rec.bestStreak);
        } else {
          menuUI.openBattleEndModal({
            won: false,
            title: '对战工厂连胜中断',
            subtitle: `历史最高纪录：${rec.bestStreak} 连胜。换一套随机租赁配置再来一局吧！`,
            primaryLabel: '重新盲抽选秀',
            onPrimary: () => teambuilderUI.openFactoryDraft(context.isDoubles),
            secondaryLabel: '返回主菜单',
            onSecondary: () => {
              void showMenuStageShowcase();
              menuUI.openMainMenu();
            },
          });
        }
        return;
      }

      // C. 正统自由对战结算
      if (won) {
        const meta = SaveStorage.getMeta();
        meta.officialWins += 1;
        SaveStorage.saveMeta(meta);
      }
      menuUI.openBattleEndModal({
        won,
        title: won ? '🏆 竞技对战获胜！' : '惜败于强敌训练家',
        subtitle: won
          ? `漂亮地击败了 ${context.trainer?.titleZh || ''}${context.trainer?.zhName || '对手'}！`
          : '调整配招、道具或赛前选出顺序，再战一局！',
        primaryLabel: '同阵容再战一局',
        onPrimary: () => void launchOfficialFreeBattle(lastFreeTeam, lastFreeIsDoubles),
        secondaryLabel: '返回自由编队',
        onSecondary: () => teambuilderUI.openOfficialFreeBuilder(lastFreeIsDoubles),
      });
    },
  });

  // 7. 三大模式开战启动器
  async function launchCurrentRogueWave(): Promise<void> {
    rogueManager.ensureAliveLead();
    const run = rogueManager.getRun();
    if (!run) return;

    const encounter = rogueManager.generateCurrentWaveEncounter();
    const cap = getWaveLevelCap(run.wave);
    const persistSlices = run.party.map((m) => ({
      hp: m.fainted ? 0 : m.hp,
      status: m.status,
      movePp: { ...m.movePp },
    }));

    screenRoot.classList.add('hidden');
    await orchestrator.startBattle(
      {
        isDoubles: false,
        teamPreview: false,
        p1Name: 'Player',
        p2Name: encounter.trainer ? encounter.trainer.zhName : 'Wild',
        p1Team: run.party.map((m) => m.set),
        p2Team: encounter.enemyTeam,
        p1Persist: persistSlices,
        p1StartingBoosts: rogueManager.getStartingBoostMap(),
        p2BossShields: encounter.bossShields,
      },
      {
        mode: 'rogue',
        isDoubles: false,
        titleZh: encounter.titleZh,
        subBadgeZh: `${encounter.biome.zhName} · 上限Lv.${cap} · ₽${run.money}`,
        biome: encounter.biome,
        trainer: encounter.trainer,
        personality:
          encounter.kind === 'boss'
            ? 'boss'
            : encounter.trainer
              ? encounter.trainer.personality
              : 'wild',
        canCatch: encounter.canCatch,
        rogueEncounter: encounter,
      },
    );
  }

  async function launchOfficialFreeBattle(playerSix: PokemonSet[], isDoubles: boolean): Promise<void> {
    const trainer = officialManager.pickRandomOpponentTrainer();
    const foeSix = officialManager.generateOpponentTeam(isDoubles, true);
    const pickSize = isDoubles ? 4 : 3;

    await orchestrator.startBattle(
      {
        isDoubles,
        teamPreview: true,
        pickedTeamSize: pickSize,
        p1Name: 'Player',
        p2Name: trainer.zhName,
        p1Team: playerSix,
        p2Team: foeSix,
      },
      {
        mode: 'official-free',
        isDoubles,
        titleZh: `Lv.50 ${isDoubles ? '双打4v4' : '单打3v3'} · ${trainer.zhName}`,
        subBadgeZh: trainer.titleZh,
        biome: OFFICIAL_ARENA,
        trainer,
        personality: trainer.personality,
        canCatch: false,
        p2PreviewTeam: foeSix,
      },
    );
  }

  async function launchFactoryBattle(): Promise<void> {
    const session = officialManager.getFactorySession();
    if (!session) return;
    const { trainer, team: foeTeam } = officialManager.prepareNextFactoryOpponent();

    screenRoot.classList.add('hidden');
    await orchestrator.startBattle(
      {
        isDoubles: session.isDoubles,
        teamPreview: false,
        p1Name: 'Player',
        p2Name: trainer.zhName,
        p1Team: session.playerTeam,
        p2Team: foeTeam,
      },
      {
        mode: 'official-factory',
        isDoubles: session.isDoubles,
        titleZh: `对战工厂 · 第 ${session.streak + 1} 战`,
        subBadgeZh: `当前 ${session.streak} 连胜`,
        biome: OFFICIAL_ARENA,
        trainer,
        personality: trainer.personality,
        canCatch: false,
      },
    );
  }

  // 初始进入主菜单并展示实时动态像素待机舞台
  await showMenuStageShowcase();
  menuUI.openMainMenu();
}

bootstrapApp().catch((err) => {
  console.error('[PokéRogue Portrait] Bootstrap error:', err);
  const deckRoot = document.getElementById('command-deck');
  if (deckRoot) {
    const msg = err instanceof Error ? err.message : String(err);
    deckRoot.innerHTML = `<div class="deck-waiting" style="flex-direction:column;gap:8px;padding:16px;text-align:center;">
      <strong style="color:#ff7b72;">启动异常：${msg}</strong>
      <button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:1px solid #58a6ff;background:#1f6feb;color:#fff;cursor:pointer;">点击重试</button>
    </div>`;
  }
});
