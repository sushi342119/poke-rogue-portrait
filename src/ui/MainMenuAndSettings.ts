import { LLMTacticalAI } from '../ai/LLMTacticalAI';
import { audioEngine, type BgmSourceMode } from '../audio/AudioEngine';
import { getBiomeById, type RogueRunManager } from '../core/RogueRunManager';
import { SaveStorage, type RogueGameMode } from '../core/SaveStorage';
import { getSpeciesZh } from '../data/dexRegistry';
import { getPokemonMiniIconStyle } from '../data/spriteResolver';

export interface MainMenuCallbacks {
  onResumeRogueRun: () => void;
  onOpenStarterWorkshop: (mode: RogueGameMode) => void;
  onOpenEggGacha: () => void;
  onPrefsChanged: () => void;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
}

/**
 * 纯正 PokéRogue 竖屏刷塔主菜单、战绩面板、胜负殿堂弹窗与战术大模型/音频设置中心
 */
export class MainMenuAndSettings {
  private screenRoot: HTMLElement;
  private modalRoot: HTMLElement;
  private rogueManager: RogueRunManager;
  private callbacks: MainMenuCallbacks;

  constructor(
    screenRoot: HTMLElement,
    modalRoot: HTMLElement,
    rogueManager: RogueRunManager,
    callbacks: MainMenuCallbacks,
  ) {
    this.screenRoot = screenRoot;
    this.modalRoot = modalRoot;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  openMainMenu(): void {
    const meta = SaveStorage.getMeta();
    const prefs = SaveStorage.getPrefs();
    const savedRun = this.rogueManager.hasSavedRun() ? this.rogueManager.getRun() : null;

    this.screenRoot.classList.remove('hidden');

    const totalVouchers =
      (meta.vouchers.common || 0) + (meta.vouchers.plus || 0) + (meta.vouchers.premium || 0);
    const totalEggs = meta.eggs.length;

    let resumeCardHtml = '';
    if (savedRun) {
      const biome = getBiomeById(savedRun.biomeId);
      const modeTag = savedRun.mode === 'endless' ? '♾ 无尽刷塔' : '🧭 经典200层';
      const luck = this.rogueManager.getPartyLuckGrade();
      const icons = savedRun.party
        .map(
          (m) =>
            `<span class="resume-mon ${m.fainted ? 'is-fainted' : ''}" title="${getSpeciesZh(m.set.species)} Lv.${m.set.level}" style="${getPokemonMiniIconStyle(m.set.species)}"></span>`,
        )
        .join('');
      resumeCardHtml = `
        <div class="menu-resume-card">
          <div class="mrc-head">
            <div>
              <span class="mrc-tag">${modeTag} · 幸运${luck}</span>
              <strong>第 ${savedRun.wave} 波 · ${biome.zhName}${savedRun.inShopPhase ? ' (整备中)' : ''}</strong>
            </div>
            <span class="mrc-gold">₽${savedRun.money}</span>
          </div>
          <div class="mrc-party">${icons}</div>
          <div class="mrc-actions">
            <button type="button" class="primary-action-btn" id="menu-btn-resume">▶ 继续第 ${savedRun.wave} 波爬塔</button>
            <button type="button" class="deck-small-btn" id="menu-btn-abandon-new">重开选宠</button>
          </div>
        </div>
      `;
    }

    const aiBadge =
      prefs.llm.enabled && prefs.llm.apiKey.trim()
        ? `🤖 外部大模型已接入 (${prefs.llm.model})`
        : '🧠 内置战术 AI 就绪';

    this.screenRoot.innerHTML = `
      <div class="main-menu-overlay">
        <div class="menu-stage-window" aria-hidden="true">
          <div class="menu-brand-pill">
            <span class="brand-dot"></span>
            <strong>PokéRogue Portrait</strong>
            <small>Showdown 战斗手感 × 纯正肉鸽刷塔</small>
          </div>
        </div>

        <div class="menu-sheet">
          ${resumeCardHtml}

          <div class="menu-mode-stack">
            <button type="button" class="mode-entry-card mode-rogue" id="menu-card-classic">
              <div class="mec-icon">🧭</div>
              <div class="mec-body">
                <strong>经典爬塔模式 (200层宿敌·道馆·终局战)</strong>
                <p>10费编队 · 6阶宿敌拦路 · 8大群系道馆主 · 10层择路分支 · 第200层无极汰那决战</p>
              </div>
              <span class="mec-arrow">→</span>
            </button>

            <button type="button" class="mode-entry-card mode-endless" id="menu-card-endless">
              <div class="mec-icon">♾</div>
              <div class="mec-body">
                <strong>无尽刷塔模式 (高费神兽·双打刷闪·冲层)</strong>
                <p>15费豪华开局 · 自带闪光护符 · 诱饵野生2v2双打 · 锁品质圣物叠层无限冲榜</p>
              </div>
              <span class="mec-arrow">→</span>
            </button>

            <button type="button" class="mode-entry-card mode-gacha" id="menu-card-gacha">
              <div class="mec-icon">🥚</div>
              <div class="mec-body">
                <div class="mec-title-row">
                  <strong>扭蛋机 & 孵蛋糖果屋</strong>
                  ${totalVouchers > 0 ? `<span class="voucher-pill-alert">🎟 可用蛋券 ×${totalVouchers}</span>` : ''}
                </div>
                <p>招式UP / 传说UP / 闪光UP 三大机台 · 孵蛋中 ${totalEggs} 枚 · 初始宠糖果减费与觉醒</p>
              </div>
              <span class="mec-arrow">→</span>
            </button>
          </div>

          <div class="menu-meta-bar">
            <div class="meta-stat">
              <span>经典200层</span>
              <strong>${meta.classicClears > 0 ? `🏆 通关${meta.classicClears}次` : `第 ${meta.highestClassicWave}/200 波`}</strong>
            </div>
            <div class="meta-stat">
              <span>无尽最高</span>
              <strong>第 ${meta.highestEndlessWave} 波</strong>
            </div>
            <div class="meta-stat">
              <span>初始宠 / 孵蛋</span>
              <strong>${meta.unlockedStarters.length}只 / ${meta.totalEggsHatched}蛋</strong>
            </div>
          </div>

          <div class="menu-bottom-bar">
            <span class="menu-ai-status">${aiBadge}</span>
            <button type="button" class="menu-settings-btn" id="menu-btn-settings">⚙ AI 与音频设置</button>
          </div>
        </div>
      </div>
    `;

    this.screenRoot.querySelector('#menu-btn-resume')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      this.hide();
      this.callbacks.onResumeRogueRun();
    });

    this.screenRoot.querySelector('#menu-btn-abandon-new')?.addEventListener('click', () => {
      audioEngine.playUiSfx('select');
      this.callbacks.onOpenStarterWorkshop(savedRun?.mode || 'classic');
    });

    this.screenRoot.querySelector('#menu-card-classic')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      this.callbacks.onOpenStarterWorkshop('classic');
    });

    this.screenRoot.querySelector('#menu-card-endless')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      this.callbacks.onOpenStarterWorkshop('endless');
    });

    this.screenRoot.querySelector('#menu-card-gacha')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      this.callbacks.onOpenEggGacha();
    });

    this.screenRoot.querySelector('#menu-btn-settings')?.addEventListener('click', () => {
      audioEngine.playUiSfx('select');
      this.openSettingsModal();
    });
  }

  hide(): void {
    this.screenRoot.classList.add('hidden');
    this.screenRoot.innerHTML = '';
  }

  openSettingsModal(): void {
    const prefs = SaveStorage.getPrefs();
    const existing = this.modalRoot.querySelector('#app-settings-modal');
    existing?.remove();

    const modal = document.createElement('div');
    modal.id = 'app-settings-modal';
    modal.className = 'sd-modal-backdrop';
    modal.innerHTML = `
      <div class="sd-sheet sd-settings-sheet">
        <div class="sd-sheet-header">
          <h3>⚙ 道馆主大模型 AI & 音频设置</h3>
          <button type="button" class="sd-close-btn" id="st-close">关闭</button>
        </div>

        <div class="ed-field">
          <label class="checkbox-row">
            <input type="checkbox" id="st-llm-enable" ${prefs.llm.enabled ? 'checked' : ''} />
            <span>启用外部大模型驱动宿敌、道馆主与天王冠军（实时博弈 + 个性台词）</span>
          </label>
          <p class="field-hint">严格遵守战争迷雾：大模型仅能看到公开战场情报，超时或断网自动无缝回退本地战术 AI。密钥仅保存在本地浏览器。</p>
        </div>

        <div class="preset-chips-row">
          <button type="button" class="preset-chip" data-ep="https://api.openai.com/v1" data-md="gpt-4o-mini">OpenAI</button>
          <button type="button" class="preset-chip" data-ep="https://api.deepseek.com/v1" data-md="deepseek-chat">DeepSeek</button>
          <button type="button" class="preset-chip" data-ep="https://generativelanguage.googleapis.com/v1beta/openai" data-md="gemini-2.5-flash">Gemini兼容</button>
        </div>

        <div class="ed-field">
          <label>OpenAI 兼容接口地址 (Base URL)</label>
          <input type="text" id="st-llm-url" class="ed-input" value="${prefs.llm.baseUrl}" placeholder="https://api.openai.com/v1" />
        </div>

        <div class="ed-two-col">
          <div class="ed-field">
            <label>模型名称 (Model)</label>
            <input type="text" id="st-llm-model" class="ed-input" value="${prefs.llm.model}" placeholder="gpt-4o-mini" />
          </div>
          <div class="ed-field">
            <label>超时回退 (毫秒)</label>
            <input type="number" id="st-llm-timeout" class="ed-input" value="${prefs.llm.timeoutMs}" min="2000" max="20000" step="500" />
          </div>
        </div>

        <div class="ed-field">
          <label>API Key</label>
          <div class="ed-search-row">
            <input type="password" id="st-llm-key" class="ed-input" value="${prefs.llm.apiKey}" placeholder="sk-..." autocomplete="off" />
            <button type="button" class="deck-small-btn" id="st-test-llm">测试连通</button>
          </div>
          <div id="st-test-result" class="llm-test-status"></div>
        </div>

        <hr class="sheet-divider" />

        <div class="ed-two-col">
          <div class="ed-field">
            <label>对战背景音乐源</label>
            <select id="st-bgm" class="tb-select">
              <option value="showdown" ${prefs.bgmMode === 'showdown' ? 'selected' : ''}>Showdown 原版曲目</option>
              <option value="chiptune" ${prefs.bgmMode === 'chiptune' ? 'selected' : ''}>8-Bit 复古芯片合成</option>
              <option value="off" ${prefs.bgmMode === 'off' ? 'selected' : ''}>静音关闭</option>
            </select>
          </div>
          <div class="ed-field">
            <label>默认刷塔演出倍速</label>
            <select id="st-speed" class="tb-select">
              <option value="1" ${prefs.battleSpeed === 1 ? 'selected' : ''}>1× 标准节奏</option>
              <option value="2" ${prefs.battleSpeed === 2 ? 'selected' : ''}>2× 爽快刷塔</option>
              <option value="4" ${prefs.battleSpeed === 4 ? 'selected' : ''}>⚡ 4× 极速冲层</option>
            </select>
          </div>
        </div>

        <label class="checkbox-row" style="margin-bottom:10px">
          <input type="checkbox" id="st-mute-sfx" ${prefs.sfxMuted ? 'checked' : ''} />
          <span>关闭宝可梦叫声与打击音效</span>
        </label>

        <button type="button" class="primary-action-btn" id="st-save">保存全部设置</button>
      </div>
    `;

    modal.querySelector('#st-close')?.addEventListener('click', () => modal.remove());

    modal.querySelectorAll<HTMLButtonElement>('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        (modal.querySelector('#st-llm-url') as HTMLInputElement).value = chip.dataset.ep || '';
        (modal.querySelector('#st-llm-model') as HTMLInputElement).value = chip.dataset.md || '';
      });
    });

    modal.querySelector('#st-test-llm')?.addEventListener('click', async () => {
      const statusEl = modal.querySelector('#st-test-result') as HTMLElement;
      statusEl.textContent = '正在请求模型端点…';
      statusEl.className = 'llm-test-status';

      const res = await LLMTacticalAI.testConnection({
        enabled: true,
        baseUrl: (modal.querySelector('#st-llm-url') as HTMLInputElement).value.trim(),
        apiKey: (modal.querySelector('#st-llm-key') as HTMLInputElement).value.trim(),
        model: (modal.querySelector('#st-llm-model') as HTMLInputElement).value.trim(),
        timeoutMs: Number((modal.querySelector('#st-llm-timeout') as HTMLInputElement).value) || 8000,
      });
      statusEl.textContent = res.message;
      statusEl.className = `llm-test-status ${res.ok ? 'ok' : 'err'}`;
    });

    modal.querySelector('#st-save')?.addEventListener('click', () => {
      prefs.llm = {
        enabled: (modal.querySelector('#st-llm-enable') as HTMLInputElement).checked,
        baseUrl: (modal.querySelector('#st-llm-url') as HTMLInputElement).value.trim(),
        apiKey: (modal.querySelector('#st-llm-key') as HTMLInputElement).value.trim(),
        model: (modal.querySelector('#st-llm-model') as HTMLInputElement).value.trim() || 'gpt-4o-mini',
        timeoutMs: Number((modal.querySelector('#st-llm-timeout') as HTMLInputElement).value) || 8500,
      };
      prefs.bgmMode = (modal.querySelector('#st-bgm') as HTMLSelectElement).value as BgmSourceMode;
      prefs.battleSpeed = Number((modal.querySelector('#st-speed') as HTMLSelectElement).value) as 1 | 2 | 4;
      prefs.sfxMuted = (modal.querySelector('#st-mute-sfx') as HTMLInputElement).checked;

      SaveStorage.savePrefs(prefs);
      audioEngine.setBgmMode(prefs.bgmMode);
      audioEngine.setSfxMuted(prefs.sfxMuted);
      audioEngine.playUiSfx('confirm');
      modal.remove();
      this.callbacks.onPrefsChanged();
      this.callbacks.onToast('设置已保存生效！', 'good');
    });

    this.modalRoot.appendChild(modal);
  }

  /**
   * 爬塔战败结算 / 经典 200 层殿堂通关庆典弹窗
   */
  openBattleEndModal(opts: {
    won: boolean;
    title: string;
    subtitle: string;
    primaryLabel: string;
    onPrimary: () => void;
    secondaryLabel: string;
    onSecondary: () => void;
  }): void {
    const modal = document.createElement('div');
    modal.className = 'sd-modal-backdrop';
    modal.innerHTML = `
      <div class="sd-sheet result-modal-sheet">
        <div class="result-badge ${opts.won ? 'win' : 'lose'}">${opts.won ? 'HALL OF FAME' : 'RUN ENDED'}</div>
        <h3>${opts.title}</h3>
        <p class="sheet-desc">${opts.subtitle}</p>
        <div class="modal-btn-row">
          <button type="button" class="primary-action-btn secondary" id="res-sec">${opts.secondaryLabel}</button>
          <button type="button" class="primary-action-btn" id="res-pri">${opts.primaryLabel}</button>
        </div>
      </div>
    `;

    modal.querySelector('#res-pri')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      modal.remove();
      opts.onPrimary();
    });

    modal.querySelector('#res-sec')?.addEventListener('click', () => {
      audioEngine.playUiSfx('select');
      modal.remove();
      opts.onSecondary();
    });

    this.modalRoot.appendChild(modal);
  }
}
