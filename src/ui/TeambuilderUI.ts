import { Dex, toID, type PokemonSet } from '@pkmn/sim';
import { TYPE_THEMES } from '../config/constants';
import {
  PRESET_TEAMS,
  exportShowdownPaste,
  importShowdownPaste,
} from '../config/presets';
import { audioEngine } from '../audio/AudioEngine';
import type { ParsedSideRequest } from '../core/BattleEngine';
import {
  buildDefaultCompetitiveSet,
  type OfficialBattleManager,
} from '../core/OfficialBattleManager';
import type { RogueRunManager } from '../core/RogueRunManager';
import { SaveStorage } from '../core/SaveStorage';
import {
  getAbilityZh,
  getItemZh,
  getMoveZh,
  getNatureZh,
  getRogueDexDatabase,
  getSpeciesZh,
} from '../data/dexRegistry';
import { getItemPixelIconUrl, getPokemonMiniIconStyle } from '../data/spriteResolver';

export interface TeambuilderCallbacks {
  onBackToMenu: () => void;
  onStartOfficialFreeBattle: (team: PokemonSet[], isDoubles: boolean) => void;
  onStartFactoryBattle: () => void;
  onSubmitTeamPreview: (choiceString: string) => void;
  onStartNewRogueRun: (starterIds: string[]) => void;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
}

const COMPETITIVE_ITEMS = [
  'Focus Sash',
  'Life Orb',
  'Leftovers',
  'Sitrus Berry',
  'Lum Berry',
  'Choice Scarf',
  'Choice Specs',
  'Choice Band',
  'Assault Vest',
  'Booster Energy',
  'Rocky Helmet',
  'Covert Cloak',
  'Heavy-Duty Boots',
  'Eviolite',
  'Mystic Water',
  'Charcoal',
];

const COMPETITIVE_NATURES = [
  'Jolly',
  'Timid',
  'Adamant',
  'Modest',
  'Bold',
  'Calm',
  'Impish',
  'Careful',
  'Brave',
  'Quiet',
];

/**
 * 赛前构筑与选阵中心：
 * 1. 正统自由编队器（单打3v3/双打4v4、预设强队、1025全图鉴单只精调、Poképaste 导入导出）
 * 2. Showdown 赛前公开选阵（Team Preview 6选3 / 6选4）
 * 3. 对战工厂（随机池租赁选秀 + 连胜战后换宠）
 * 4. PokéRogue 开局选宠（快捷平衡三选一 + 经典 10 费预算多宠构筑）
 */
export class TeambuilderUI {
  private screenRoot: HTMLElement;
  private modalRoot: HTMLElement;
  private officialManager: OfficialBattleManager;
  private rogueManager: RogueRunManager;
  private callbacks: TeambuilderCallbacks;

  private freeIsDoubles = false;
  private currentPresetId = PRESET_TEAMS[0].id;
  private workingTeam: PokemonSet[] = importShowdownPaste(PRESET_TEAMS[0].paste, true);

  constructor(
    screenRoot: HTMLElement,
    modalRoot: HTMLElement,
    officialManager: OfficialBattleManager,
    rogueManager: RogueRunManager,
    callbacks: TeambuilderCallbacks,
  ) {
    this.screenRoot = screenRoot;
    this.modalRoot = modalRoot;
    this.officialManager = officialManager;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  hide(): void {
    this.screenRoot.classList.add('hidden');
    this.screenRoot.innerHTML = '';
  }

  // =========================================================================
  // 1. 正统自由编队器 (Official Free Battle Teambuilder + Poképaste)
  // =========================================================================
  openOfficialFreeBuilder(defaultDoubles = false): void {
    this.freeIsDoubles = defaultDoubles;
    this.screenRoot.classList.remove('hidden');
    this.renderFreeBuilder();
  }

  private renderFreeBuilder(): void {
    const customTeams = SaveStorage.getCustomTeams();
    const presetOptions = PRESET_TEAMS.map(
      (p) =>
        `<option value="preset:${p.id}" ${this.currentPresetId === p.id ? 'selected' : ''}>[预设] ${p.zhTitle}</option>`,
    ).join('');
    const customOptions = customTeams
      .map(
        (c) =>
          `<option value="custom:${c.id}" ${this.currentPresetId === c.id ? 'selected' : ''}>[自建] ${c.name}</option>`,
      )
      .join('');

    const cardsHtml = this.workingTeam
      .map((mon, idx) => {
        const tera = mon.teraType || 'Normal';
        const th = TYPE_THEMES[tera] || TYPE_THEMES.Normal;
        const movesZh = mon.moves.slice(0, 4).map((m) => getMoveZh(m)).join(' · ');
        return `
          <div class="tb-mon-card">
            <div class="tb-mon-main">
              <span style="${getPokemonMiniIconStyle(mon.species)}"></span>
              <div class="tb-mon-info">
                <div class="tb-mon-title">
                  <strong>${getSpeciesZh(mon.species)}</strong>
                  <span class="sd-type-badge" style="background:${th.bg}">💎${th.zh}</span>
                </div>
                <div class="tb-mon-sub">
                  ${getAbilityZh(mon.ability)} · ${mon.item ? `<img class="inline-item-ico" src="${getItemPixelIconUrl(mon.item)}" alt="" />${getItemZh(mon.item)}` : '无道具'} · ${getNatureZh(mon.nature || 'Serious')}
                </div>
                <div class="tb-mon-moves">${movesZh}</div>
              </div>
              <button type="button" class="tb-edit-btn" data-edit-idx="${idx}">编辑</button>
            </div>
          </div>
        `;
      })
      .join('');

    this.screenRoot.innerHTML = `
      <div class="full-screen-panel">
        <header class="panel-topbar">
          <button type="button" class="nav-back-btn" id="tb-back">← 主菜单</button>
          <h2>⚔ 正统竞技自由编队</h2>
          <button type="button" class="nav-action-btn" id="tb-pokepaste">Poképaste</button>
        </header>

        <div class="format-seg-bar">
          <button type="button" class="seg-btn ${!this.freeIsDoubles ? 'active' : ''}" data-fmt="singles">
            Lv.50 单打 (6选3)
          </button>
          <button type="button" class="seg-btn ${this.freeIsDoubles ? 'active' : ''}" data-fmt="doubles">
            Lv.50 双打 (6选4)
          </button>
        </div>

        <div class="tb-preset-row">
          <select id="tb-team-select" class="tb-select" aria-label="选择预设或自建队伍">
            ${presetOptions}
            ${customOptions}
          </select>
          <button type="button" class="tb-save-custom-btn" id="tb-save-team">存为自建</button>
        </div>

        <div class="tb-roster-scroll">
          ${cardsHtml}
        </div>

        <footer class="panel-footer">
          <button type="button" class="primary-action-btn" id="tb-start-battle">
            进入赛前选出 (${this.freeIsDoubles ? '双打 4v4' : '单打 3v3'}) →
          </button>
        </footer>
      </div>
    `;

    this.screenRoot.querySelector('#tb-back')?.addEventListener('click', () => {
      audioEngine.playUiSfx('cancel');
      this.hide();
      this.callbacks.onBackToMenu();
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.freeIsDoubles = btn.dataset.fmt === 'doubles';
        audioEngine.playUiSfx('select');
        this.renderFreeBuilder();
      });
    });

    this.screenRoot.querySelector('#tb-team-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val.startsWith('preset:')) {
        const id = val.slice(7);
        const found = PRESET_TEAMS.find((p) => p.id === id);
        if (found) {
          this.currentPresetId = id;
          this.workingTeam = importShowdownPaste(found.paste, true);
        }
      } else if (val.startsWith('custom:')) {
        const id = val.slice(7);
        const found = SaveStorage.getCustomTeams().find((c) => c.id === id);
        if (found) {
          this.currentPresetId = id;
          this.workingTeam = importShowdownPaste(found.paste, true);
        }
      }
      audioEngine.playUiSfx('select');
      this.renderFreeBuilder();
    });

    this.screenRoot.querySelector('#tb-save-team')?.addEventListener('click', () => {
      const list = SaveStorage.getCustomTeams();
      const newId = `team_${Date.now().toString(36)}`;
      const name = `自建战队 #${list.length + 1} (${getSpeciesZh(this.workingTeam[0]?.species || 'Pikachu')})`;
      list.push({
        id: newId,
        name,
        isDoubles: this.freeIsDoubles,
        paste: exportShowdownPaste(this.workingTeam),
      });
      SaveStorage.saveCustomTeams(list);
      this.currentPresetId = newId;
      audioEngine.playUiSfx('confirm');
      this.callbacks.onToast(`已保存【${name}】！`, 'good');
      this.renderFreeBuilder();
    });

    this.screenRoot.querySelector('#tb-pokepaste')?.addEventListener('click', () => {
      this.openPokepasteModal();
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-edit-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.editIdx);
        this.openSingleSetEditorModal(idx);
      });
    });

    this.screenRoot.querySelector('#tb-start-battle')?.addEventListener('click', () => {
      audioEngine.playUiSfx('confirm');
      this.hide();
      this.callbacks.onStartOfficialFreeBattle(this.workingTeam, this.freeIsDoubles);
    });
  }

  private openPokepasteModal(): void {
    const exported = exportShowdownPaste(this.workingTeam);
    const modal = document.createElement('div');
    modal.className = 'sd-modal-backdrop';
    modal.innerHTML = `
      <div class="sd-sheet">
        <div class="sd-sheet-header">
          <h3>📋 Showdown Poképaste 导入 / 导出</h3>
          <button type="button" class="sd-close-btn" id="pp-close">关闭</button>
        </div>
        <p class="sheet-desc">可直接粘贴 Smogon / Pokémon Showdown 标准英文队伍文本（最多 6 只，自动校准至 Lv.50）：</p>
        <textarea id="pp-textarea" class="pp-textarea" rows="10" spellcheck="false">${exported}</textarea>
        <div class="modal-btn-row">
          <button type="button" class="primary-action-btn secondary" id="pp-copy">复制当前文本</button>
          <button type="button" class="primary-action-btn" id="pp-import">解析并应用队伍</button>
        </div>
      </div>
    `;

    modal.querySelector('#pp-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#pp-copy')?.addEventListener('click', async () => {
      const txt = (modal.querySelector('#pp-textarea') as HTMLTextAreaElement).value;
      try {
        await navigator.clipboard.writeText(txt);
        this.callbacks.onToast('Poképaste 已复制到剪贴板！', 'good');
      } catch {
        this.callbacks.onToast('请长按文本框手动复制', 'info');
      }
    });

    modal.querySelector('#pp-import')?.addEventListener('click', () => {
      const raw = (modal.querySelector('#pp-textarea') as HTMLTextAreaElement).value.trim();
      const parsed = importShowdownPaste(raw, true).filter((s) => Dex.species.get(s.species).exists);
      if (parsed.length === 0) {
        audioEngine.playUiSfx('cancel');
        this.callbacks.onToast('未能识别有效宝可梦配置，请检查格式', 'warn');
        return;
      }
      this.workingTeam = parsed.slice(0, 6);
      audioEngine.playUiSfx('confirm');
      modal.remove();
      this.callbacks.onToast(`成功导入 ${this.workingTeam.length} 只竞技宝可梦！`, 'good');
      this.renderFreeBuilder();
    });

    this.modalRoot.appendChild(modal);
  }

  private openSingleSetEditorModal(slotIdx: number): void {
    let mon = { ...this.workingTeam[slotIdx], moves: [...this.workingTeam[slotIdx].moves] };
    const db = getRogueDexDatabase();

    const modal = document.createElement('div');
    modal.className = 'sd-modal-backdrop';

    const renderEditor = () => {
      const sp = Dex.species.get(mon.species);
      const abilities = Object.values(sp.abilities || {});
      const teraTypes = Object.keys(TYPE_THEMES);

      modal.innerHTML = `
        <div class="sd-sheet sd-editor-sheet">
          <div class="sd-sheet-header">
            <h3>🔧 槽位 #${slotIdx + 1} · ${getSpeciesZh(mon.species)}</h3>
            <button type="button" class="sd-close-btn" id="ed-close">取消</button>
          </div>

          <div class="ed-field">
            <label>更换宝可梦（输入中文或英文名搜索全 1025 图鉴）：</label>
            <div class="ed-search-row">
              <input type="text" id="ed-sp-query" class="ed-input" placeholder="如：快龙 / 多龙巴鲁托 / Garchomp" />
              <button type="button" class="deck-small-btn" id="ed-sp-apply">切换物种</button>
            </div>
          </div>

          <div class="ed-two-col">
            <div class="ed-field">
              <label>特性</label>
              <select id="ed-ability" class="tb-select">
                ${abilities
                  .map(
                    (ab) =>
                      `<option value="${ab}" ${mon.ability === ab ? 'selected' : ''}>${getAbilityZh(ab)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="ed-field">
              <label>太晶属性</label>
              <select id="ed-tera" class="tb-select">
                ${teraTypes
                  .map(
                    (t) =>
                      `<option value="${t}" ${(mon.teraType || 'Normal') === t ? 'selected' : ''}>${TYPE_THEMES[t].zh}</option>`,
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="ed-two-col">
            <div class="ed-field">
              <label>携带道具</label>
              <select id="ed-item" class="tb-select">
                ${Array.from(new Set([mon.item || 'Focus Sash', ...COMPETITIVE_ITEMS]))
                  .filter(Boolean)
                  .map(
                    (it) =>
                      `<option value="${it}" ${mon.item === it ? 'selected' : ''}>${getItemZh(it)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="ed-field">
              <label>性格修正</label>
              <select id="ed-nature" class="tb-select">
                ${Array.from(new Set([mon.nature || 'Jolly', ...COMPETITIVE_NATURES]))
                  .map(
                    (nat) =>
                      `<option value="${nat}" ${mon.nature === nat ? 'selected' : ''}>${getNatureZh(nat)} (${nat})</option>`,
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="ed-field">
            <label>4 个配招（支持输入中文招式名如“十万伏特”、“守住”或英文名）：</label>
            <div class="ed-moves-inputs">
              ${[0, 1, 2, 3]
                .map((mIdx) => {
                  const curMv = mon.moves[mIdx] || '';
                  return `<input type="text" class="ed-input ed-mv-in" data-mv-slot="${mIdx}" value="${curMv ? getMoveZh(curMv) : ''}" placeholder="招式 ${mIdx + 1}" />`;
                })
                .join('')}
            </div>
          </div>

          <button type="button" class="primary-action-btn" id="ed-save">保存该宝可梦配置</button>
        </div>
      `;

      modal.querySelector('#ed-close')?.addEventListener('click', () => modal.remove());

      modal.querySelector('#ed-sp-apply')?.addEventListener('click', () => {
        const q = (modal.querySelector('#ed-sp-query') as HTMLInputElement).value.trim();
        if (!q) return;
        let matchedSpecies = '';
        const direct = Dex.species.get(q);
        if (direct.exists) {
          matchedSpecies = direct.name;
        } else {
          const foundId = Object.keys(db.species).find(
            (id) => db.species[id].zh === q || db.species[id].zh.includes(q),
          );
          if (foundId) {
            matchedSpecies = Dex.species.get(foundId).name;
          }
        }
        if (!matchedSpecies) {
          this.callbacks.onToast(`未找到宝可梦“${q}”`, 'warn');
          return;
        }
        mon = buildDefaultCompetitiveSet(matchedSpecies);
        audioEngine.playUiSfx('select');
        renderEditor();
      });

      modal.querySelector('#ed-save')?.addEventListener('click', () => {
        mon.ability = (modal.querySelector('#ed-ability') as HTMLSelectElement).value;
        mon.teraType = (modal.querySelector('#ed-tera') as HTMLSelectElement).value;
        mon.item = (modal.querySelector('#ed-item') as HTMLSelectElement).value;
        mon.nature = (modal.querySelector('#ed-nature') as HTMLSelectElement).value;

        const resolvedMoves: string[] = [];
        modal.querySelectorAll<HTMLInputElement>('.ed-mv-in').forEach((inp) => {
          const val = inp.value.trim();
          if (!val) return;
          const directMv = Dex.moves.get(val);
          if (directMv.exists) {
            resolvedMoves.push(directMv.name);
            return;
          }
          const zhEntry = Object.entries(db.movesZh).find(
            ([, zh]) => zh === val || zh.includes(val),
          );
          if (zhEntry) {
            const dm = Dex.moves.get(zhEntry[0]);
            if (dm.exists) resolvedMoves.push(dm.name);
          }
        });

        if (resolvedMoves.length > 0) {
          mon.moves = resolvedMoves.slice(0, 4);
        }

        this.workingTeam[slotIdx] = mon;
        audioEngine.playUiSfx('confirm');
        modal.remove();
        this.renderFreeBuilder();
      });
    };

    renderEditor();
    this.modalRoot.appendChild(modal);
  }

  // =========================================================================
  // 2. Showdown 赛前公开选阵 (Team Preview: 6选3 / 6选4)
  // =========================================================================
  openTeamPreview(
    req: ParsedSideRequest,
    opponentPreviewTeam: PokemonSet[],
    isDoubles: boolean,
  ): void {
    const needed = req.maxChosenTeamSize || (isDoubles ? 4 : 3);
    const chosenOrder: number[] = []; // 1-based indices

    this.screenRoot.classList.remove('hidden');

    const renderPreview = () => {
      const foeIcons = opponentPreviewTeam
        .map(
          (f) => `
          <div class="tp-foe-chip">
            <span style="${getPokemonMiniIconStyle(f.species)}"></span>
            <small>${getSpeciesZh(f.species)}</small>
          </div>
        `,
        )
        .join('');

      const myCards = req.side.pokemon
        .map((m) => {
          const pickPos = chosenOrder.indexOf(m.index);
          const selected = pickPos !== -1;
          const orderTag = selected
            ? isDoubles
              ? pickPos === 0
                ? '左首发'
                : pickPos === 1
                  ? '右首发'
                  : `后备 ${pickPos + 1}`
              : pickPos === 0
                ? '首发 #1'
                : `出战 #${pickPos + 1}`
            : '点击选出';
          return `
            <button type="button" class="tp-my-card ${selected ? 'is-picked' : ''}" data-tp-idx="${m.index}">
              <div class="tp-card-head">
                <span style="${getPokemonMiniIconStyle(m.species)}"></span>
                <div>
                  <strong>${m.zhName}</strong>
                  <span>${getAbilityZh(m.ability)} · ${m.item ? getItemZh(m.item) : '无道具'}</span>
                </div>
                <em class="tp-order-badge">${orderTag}</em>
              </div>
              <div class="tp-card-moves">${m.moves.map(getMoveZh).join(' / ')}</div>
            </button>
          `;
        })
        .join('');

      this.screenRoot.innerHTML = `
        <div class="full-screen-panel">
          <header class="panel-topbar">
            <h2>👁 Showdown 赛前公开选出 (${chosenOrder.length}/${needed})</h2>
          </header>

          <section class="tp-foe-box">
            <div class="tp-sec-label">对手公开的 6 只报名阵容（请针对性排兵布阵）：</div>
            <div class="tp-foe-grid">${foeIcons}</div>
          </section>

          <div class="tp-sec-label">按出场顺序点选我方 <b>${needed}</b> 只参战宝可梦：</div>
          <div class="tb-roster-scroll">
            ${myCards}
          </div>

          <footer class="panel-footer">
            <button type="button" class="primary-action-btn" id="tp-confirm" ${chosenOrder.length < needed ? 'disabled' : ''}>
              锁定阵容 · 正式开战！
            </button>
          </footer>
        </div>
      `;

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-tp-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.tpIdx);
          const pos = chosenOrder.indexOf(idx);
          if (pos !== -1) {
            chosenOrder.splice(pos, 1);
          } else if (chosenOrder.length < needed) {
            chosenOrder.push(idx);
          }
          audioEngine.playUiSfx('select');
          renderPreview();
        });
      });

      this.screenRoot.querySelector('#tp-confirm')?.addEventListener('click', () => {
        if (chosenOrder.length < needed) return;
        this.hide();
        this.callbacks.onSubmitTeamPreview(`team ${chosenOrder.join('')}`);
      });
    };

    renderPreview();
  }

  // =========================================================================
  // 3. 对战工厂 (Battle Factory: 随机池选秀 & 连胜战后换宠)
  // =========================================================================
  openFactoryDraft(defaultDoubles = false): void {
    let isDoubles = defaultDoubles;
    let session = this.officialManager.startFactorySession(isDoubles);
    let picked: number[] = [];

    this.screenRoot.classList.remove('hidden');

    const renderDraft = () => {
      const needed = isDoubles ? 4 : 3;
      const meta = SaveStorage.getMeta();
      const best = isDoubles ? meta.factoryBestStreakDoubles : meta.factoryBestStreakSingles;

      const cards = session.draftPool
        .map((mon, idx) => {
          const order = picked.indexOf(idx);
          const tera = mon.teraType || 'Normal';
          const th = TYPE_THEMES[tera] || TYPE_THEMES.Normal;
          return `
            <button type="button" class="tp-my-card ${order !== -1 ? 'is-picked' : ''}" data-fac-idx="${idx}">
              <div class="tp-card-head">
                <span style="${getPokemonMiniIconStyle(mon.species)}"></span>
                <div>
                  <strong>${getSpeciesZh(mon.species)} <span class="sd-type-badge" style="background:${th.bg}">💎${th.zh}</span></strong>
                  <span>${getAbilityZh(mon.ability)} · ${getItemZh(mon.item)}</span>
                </div>
                <em class="tp-order-badge">${order !== -1 ? `#${order + 1} 已租用` : '租用'}</em>
              </div>
              <div class="tp-card-moves">${mon.moves.map(getMoveZh).join(' · ')}</div>
            </button>
          `;
        })
        .join('');

      this.screenRoot.innerHTML = `
        <div class="full-screen-panel">
          <header class="panel-topbar">
            <button type="button" class="nav-back-btn" id="fac-back">← 主菜单</button>
            <h2>🏭 对战工厂租赁选秀</h2>
            <span class="streak-pill">最高 ${best} 连胜</span>
          </header>

          <div class="format-seg-bar">
            <button type="button" class="seg-btn ${!isDoubles ? 'active' : ''}" data-fac-fmt="singles">单打 6选3</button>
            <button type="button" class="seg-btn ${isDoubles ? 'active' : ''}" data-fac-fmt="doubles">双打 8选4</button>
          </div>

          <div class="tp-sec-label">从随机竞技成品池中挑选 <b>${needed}</b> 只组建租赁战队 (${picked.length}/${needed})：</div>
          <div class="tb-roster-scroll">${cards}</div>

          <footer class="panel-footer">
            <button type="button" class="primary-action-btn" id="fac-lock" ${picked.length < needed ? 'disabled' : ''}>
              锁定租赁小队 · 开始连胜挑战！
            </button>
          </footer>
        </div>
      `;

      this.screenRoot.querySelector('#fac-back')?.addEventListener('click', () => {
        audioEngine.playUiSfx('cancel');
        this.hide();
        this.callbacks.onBackToMenu();
      });

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-fac-fmt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          isDoubles = btn.dataset.facFmt === 'doubles';
          session = this.officialManager.startFactorySession(isDoubles);
          picked = [];
          audioEngine.playUiSfx('select');
          renderDraft();
        });
      });

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-fac-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.facIdx);
          const pos = picked.indexOf(idx);
          if (pos !== -1) picked.splice(pos, 1);
          else if (picked.length < needed) picked.push(idx);
          audioEngine.playUiSfx('select');
          renderDraft();
        });
      });

      this.screenRoot.querySelector('#fac-lock')?.addEventListener('click', () => {
        this.officialManager.lockFactoryDraft(picked);
        audioEngine.playUiSfx('confirm');
        this.hide();
        this.callbacks.onStartFactoryBattle();
      });
    };

    renderDraft();
  }

  openFactorySwapAfterWin(streak: number, bestStreak: number): void {
    const session = this.officialManager.getFactorySession();
    if (!session) return;

    let ownIdx = 0;
    let oppIdx = -1;
    this.screenRoot.classList.remove('hidden');

    const renderSwap = () => {
      this.screenRoot.innerHTML = `
        <div class="full-screen-panel">
          <header class="panel-topbar">
            <h2>🏆 对战工厂 · 当前 ${streak} 连胜！</h2>
            <span class="streak-pill">纪录 ${bestStreak}</span>
          </header>

          <div class="tb-roster-scroll">
            <div class="tp-sec-label">① 选择要换出的我方宝可梦：</div>
            ${session.playerTeam
              .map(
                (m, i) => `
              <button type="button" class="tp-my-card ${ownIdx === i ? 'is-picked' : ''}" data-own-i="${i}">
                <div class="tp-card-head">
                  <span style="${getPokemonMiniIconStyle(m.species)}"></span>
                  <div>
                    <strong>${getSpeciesZh(m.species)}</strong>
                    <span>${getAbilityZh(m.ability)} · ${getItemZh(m.item)}</span>
                  </div>
                  <em class="tp-order-badge">${ownIdx === i ? '准备换出' : '选择'}</em>
                </div>
              </button>
            `,
              )
              .join('')}

            <div class="tp-sec-label" style="margin-top:10px">② 选择要换入的对手宝可梦（可选）：</div>
            ${session.lastOpponentTeam
              .map(
                (m, i) => `
              <button type="button" class="tp-my-card ${oppIdx === i ? 'is-picked' : ''}" data-opp-i="${i}">
                <div class="tp-card-head">
                  <span style="${getPokemonMiniIconStyle(m.species)}"></span>
                  <div>
                    <strong>${getSpeciesZh(m.species)}</strong>
                    <span>${getAbilityZh(m.ability)} · ${getItemZh(m.item)}</span>
                  </div>
                  <em class="tp-order-badge">${oppIdx === i ? '准备换入' : '缴获'}</em>
                </div>
                <div class="tp-card-moves">${m.moves.map(getMoveZh).join(' · ')}</div>
              </button>
            `,
              )
              .join('')}
          </div>

          <footer class="panel-footer two-btns">
            <button type="button" class="primary-action-btn secondary" id="fac-skip-swap">
              不交换 · 下一战
            </button>
            <button type="button" class="primary-action-btn" id="fac-do-swap" ${oppIdx < 0 ? 'disabled' : ''}>
              确认交换 · 下一战 →
            </button>
          </footer>
        </div>
      `;

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-own-i]').forEach((b) => {
        b.addEventListener('click', () => {
          ownIdx = Number(b.dataset.ownI);
          audioEngine.playUiSfx('select');
          renderSwap();
        });
      });

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-opp-i]').forEach((b) => {
        b.addEventListener('click', () => {
          oppIdx = Number(b.dataset.oppI);
          audioEngine.playUiSfx('select');
          renderSwap();
        });
      });

      this.screenRoot.querySelector('#fac-skip-swap')?.addEventListener('click', () => {
        audioEngine.playUiSfx('confirm');
        this.hide();
        this.callbacks.onStartFactoryBattle();
      });

      this.screenRoot.querySelector('#fac-do-swap')?.addEventListener('click', () => {
        if (oppIdx >= 0) {
          this.officialManager.swapFactoryMember(ownIdx, oppIdx);
        }
        audioEngine.playUiSfx('confirm');
        this.hide();
        this.callbacks.onStartFactoryBattle();
      });
    };

    renderSwap();
  }

  // =========================================================================
  // 4. PokéRogue 无尽肉鸽开局选宠 (快捷平衡三选一 + 10 费自由预算编队)
  // =========================================================================
  openRogueStarterSelect(): void {
    let quickTrio = this.rogueManager.rollQuickStarterTrio();
    const selectedCustom: string[] = ['charmander', 'bulbasaur'];
    let searchQuery = '';

    this.screenRoot.classList.remove('hidden');

    const renderStarterScreen = () => {
      const meta = SaveStorage.getMeta();
      const db = getRogueDexDatabase();
      const usedCost = selectedCustom.reduce(
        (sum, id) => sum + this.rogueManager.getEffectiveStarterCost(id),
        0,
      );

      // 候选初始宠列表（已解锁优先，支持中文搜索筛选）
      const unlockedSet = new Set<string>(meta.unlockedStarters.map((s) => toID(s)));
      const allStarterIds = Object.keys(db.species).filter((id) => {
        const entry = db.species[id];
        if (!unlockedSet.has(id) && !entry.starter) return false;
        if (searchQuery) {
          return entry.zh.includes(searchQuery) || id.includes(searchQuery.toLowerCase());
        }
        return unlockedSet.has(id);
      });

      const quickCardsHtml = quickTrio
        .map((id) => {
          const sp = Dex.species.get(id);
          const th = TYPE_THEMES[sp.types[0] || 'Normal'] || TYPE_THEMES.Normal;
          return `
            <button type="button" class="quick-trio-card" data-quick-id="${id}" style="border-bottom:3px solid ${th.bg}">
              <span style="${getPokemonMiniIconStyle(sp.name)}"></span>
              <strong>${getSpeciesZh(sp.name)}</strong>
              <small>${th.zh}系 · 一键出发</small>
            </button>
          `;
        })
        .join('');

      const gridHtml = allStarterIds
        .slice(0, 48)
        .map((id) => {
          const unlocked = unlockedSet.has(id);
          const cost = this.rogueManager.getEffectiveStarterCost(id);
          const picked = selectedCustom.includes(id);
          const candies = meta.starterCandies[id] || 0;
          const canAdd =
            picked || (unlocked && selectedCustom.length < 3 && usedCost + cost <= 10);

          return `
            <button
              type="button"
              class="rogue-starter-cell ${picked ? 'is-picked' : ''} ${!unlocked ? 'is-locked' : ''}"
              data-st-id="${id}"
              ${!canAdd && !picked ? 'disabled' : ''}
            >
              <span class="cost-badge">${cost}费</span>
              <span style="${getPokemonMiniIconStyle(id)}"></span>
              <strong>${getSpeciesZh(id)}</strong>
              <small>${!unlocked ? '未收服解锁' : candies > 0 ? `🍬${candies}` : '可出战'}</small>
            </button>
          `;
        })
        .join('');

      this.screenRoot.innerHTML = `
        <div class="full-screen-panel">
          <header class="panel-topbar">
            <button type="button" class="nav-back-btn" id="rg-back">← 主菜单</button>
            <h2>🧭 无尽肉鸽 · 初始同行选宠</h2>
          </header>

          <section class="quick-trio-box">
            <div class="qt-head">
              <span>⚡ 经典三选一快速开局（点击任一即刻出发）：</span>
              <button type="button" class="deck-small-btn" id="rg-reroll-trio">🎲 换一批</button>
            </div>
            <div class="quick-trio-row">${quickCardsHtml}</div>
          </section>

          <section class="cost-builder-box">
            <div class="cb-head">
              <div>
                <strong>🎒 PokéRogue 10 费多宠编队</strong>
                <span class="cost-meter ${usedCost > 10 ? 'over' : ''}">预算 ${usedCost} / 10 费 · 已选 ${selectedCustom.length}/3 只</span>
              </div>
              <input type="text" id="rg-search" class="ed-input rg-search-in" value="${searchQuery}" placeholder="搜中文名…" />
            </div>

            <div class="rogue-starter-grid">${gridHtml}</div>
          </section>

          <footer class="panel-footer">
            <button type="button" class="primary-action-btn" id="rg-start-custom" ${selectedCustom.length === 0 || usedCost > 10 ? 'disabled' : ''}>
              携已选同伴 (${selectedCustom.map(getSpeciesZh).join(' + ')}) 踏入第 1 波 →
            </button>
          </footer>
        </div>
      `;

      this.screenRoot.querySelector('#rg-back')?.addEventListener('click', () => {
        audioEngine.playUiSfx('cancel');
        this.hide();
        this.callbacks.onBackToMenu();
      });

      this.screenRoot.querySelector('#rg-reroll-trio')?.addEventListener('click', () => {
        quickTrio = this.rogueManager.rollQuickStarterTrio();
        audioEngine.playUiSfx('select');
        renderStarterScreen();
      });

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-quick-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.quickId!;
          audioEngine.playUiSfx('confirm');
          this.hide();
          this.callbacks.onStartNewRogueRun([id]);
        });
      });

      this.screenRoot.querySelector('#rg-search')?.addEventListener('input', (e) => {
        searchQuery = (e.target as HTMLInputElement).value.trim();
        renderStarterScreen();
        const inputEl = this.screenRoot.querySelector('#rg-search') as HTMLInputElement | null;
        if (inputEl) {
          inputEl.focus();
          inputEl.setSelectionRange(searchQuery.length, searchQuery.length);
        }
      });

      this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-st-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.stId!;
          const idx = selectedCustom.indexOf(id);
          if (idx !== -1) {
            selectedCustom.splice(idx, 1);
          } else {
            const cost = this.rogueManager.getEffectiveStarterCost(id);
            if (selectedCustom.length < 3 && usedCost + cost <= 10) {
              selectedCustom.push(id);
            }
          }
          audioEngine.playUiSfx('select');
          renderStarterScreen();
        });
      });

      this.screenRoot.querySelector('#rg-start-custom')?.addEventListener('click', () => {
        if (selectedCustom.length === 0) return;
        audioEngine.playUiSfx('confirm');
        this.hide();
        this.callbacks.onStartNewRogueRun([...selectedCustom]);
      });
    };

    renderStarterScreen();
  }
}
