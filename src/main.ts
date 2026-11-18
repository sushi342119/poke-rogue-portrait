import Phaser from 'phaser';
import './styles/main.css';
import {
  BIOMES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  getWaveLevelCap,
} from './config/constants';
import { audioEngine } from './audio/AudioEngine';
import { BattleOrchestrator } from './core/BattleOrchestrator';
import { RogueRunManager } from './core/RogueRunManager';
import { SaveStorage, type RogueGameMode } from './core/SaveStorage';
import { loadRogueDex } from './data/dexRegistry';
import { BattleScene } from './scenes/BattleScene';
import { CommandDeckUI } from './ui/CommandDeckUI';
import { MainMenuAndSettings } from './ui/MainMenuAndSettings';
import { RogueHubUI } from './ui/RogueHubUI';
import { RogueShopUI } from './ui/RogueShopUI';
import { ShowdownHUD } from './ui/ShowdownHUD';

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

  deckRoot.innerHTML = `<div class="deck-waiting"><span class="deck-spinner"></span><span>正在加载 1025 全世代中文图鉴与肉鸽爬塔引擎…</span></div>`;

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

  // 4. 初始化肉鸽爬塔核心状态机
  const rogueManager = new RogueRunManager();

  const showMenuStageShowcase = async () => {
    hud.setVisible(false);
    battleScene.setFormation(false);
    battleScene.applyBiome(BIOMES[0]);
    void battleScene.getActor('p1a')?.setPokemon('Charizard', { animateEntry: true, shiny: true });
    void battleScene.getActor('p2a')?.setPokemon('Rayquaza', { animateEntry: true, shiny: true });
    audioEngine.playMenuBgm();
  };

  // 5. 初始化纯肉鸽 UI 组件群
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
      rogueHubUI.hide();
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

  const rogueHubUI = new RogueHubUI(screenRoot, modalRoot, rogueManager, {
    onBackToMenu: () => {
      void showMenuStageShowcase();
      menuUI.openMainMenu();
    },
    onStartNewRogueRun: (starterIds: string[], mode: RogueGameMode) => {
      rogueManager.startNewRun(starterIds, mode);
      void launchCurrentRogueWave();
    },
    onToast: (msg, tone) => showToast(modalRoot, msg, tone),
  });

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
    onOpenStarterWorkshop: (mode) => {
      rogueHubUI.openStarterWorkshop(mode);
    },
    onOpenEggGacha: () => {
      rogueHubUI.openEggGacha();
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
      if (!context.rogueEncounter) return;

      if (!won) {
        const { wave, mode } = rogueManager.handleRunDefeat();
        menuUI.openBattleEndModal({
          won: false,
          title: `${mode === 'endless' ? '无尽征程' : '经典爬塔'}止步于 第 ${wave} 波`,
          subtitle: '全队宝可梦失去了战斗能力。收服解锁的新初始宠、糖果与已掉落蛋券均已永久保留！',
          primaryLabel: '去选宠/抽蛋再战',
          onPrimary: () => rogueHubUI.openStarterWorkshop(mode),
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

      // 若有彩蛋在本波破壳孵化，先展示破壳惊喜！
      if (summary.hatchedEggs.length > 0) {
        await rogueHubUI.openEggHatchSummaryModal(summary.hatchedEggs);
      }

      // 经典 200 层终局无极汰那通关殿堂庆典！
      if (summary.classicCleared) {
        menuUI.openBattleEndModal({
          won: true,
          title: '🏆 经典 200 层终焉制霸！荣耀入驻殿堂！',
          subtitle:
            '你成功击破了第 200 波终焉霸主无极汰那！参战全员已授予【殿堂通关缎带】与 +5 糖果，并奖励 👑黄金十连蛋券 ×1！',
          primaryLabel: '前往扭蛋机十连抽！',
          onPrimary: () => rogueHubUI.openEggGacha(),
          secondaryLabel: '开启 15 费无尽刷塔',
          onSecondary: () => rogueHubUI.openStarterWorkshop('endless'),
        });
        return;
      }

      if (capturedSet) {
        await shopUI.promptPartyFullCaptureIfNeeded(capturedSet);
      }
      await shopUI.openPostWaveShop(summary);
    },
  });

  // 7. 启动当前爬塔波次（自动兼容 1v1 与诱饵触发的 2v2 野生双打！）
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

    const modeBadge = run.mode === 'endless' ? '无尽' : '经典';
    screenRoot.classList.add('hidden');
    await orchestrator.startBattle(
      {
        isDoubles: encounter.isDoubles,
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
        isDoubles: encounter.isDoubles,
        titleZh: encounter.titleZh,
        subBadgeZh: `${modeBadge} · ${encounter.biome.zhName} · 上限Lv.${cap} · ₽${run.money}`,
        biome: encounter.biome,
        trainer: encounter.trainer,
        personality:
          encounter.kind === 'boss' || encounter.kind === 'final-boss'
            ? 'boss'
            : encounter.trainer
              ? encounter.trainer.personality
              : 'wild',
        canCatch: encounter.canCatch,
        rogueEncounter: encounter,
      },
    );
  }

  // 注册安卓原生返回手势桥接：优先关闭弹窗 -> 返回主菜单 -> 根视图安全退回桌面后台
  (window as unknown as { __handleAndroidBack?: () => string }).__handleAndroidBack = () => {
    const topModal = modalRoot.querySelector('.sd-modal-backdrop:last-of-type');
    if (topModal) {
      topModal.remove();
      audioEngine.playUiSfx('cancel');
      return 'handled';
    }
    if (!screenRoot.classList.contains('hidden') && screenRoot.querySelector('.rogue-hub-screen')) {
      rogueHubUI.hide();
      void showMenuStageShowcase();
      menuUI.openMainMenu();
      audioEngine.playUiSfx('cancel');
      return 'handled';
    }
    return 'root';
  };

  // 初始进入主菜单并展示异色闪光喷火龙 vs 闪光裂空座像素待机舞台
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
