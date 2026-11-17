import Phaser from 'phaser';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { STAGE_HEIGHT, STAGE_WIDTH, type BattleSlotId, type SlotAnchor } from '../config/constants';
import { resolvePokemonSpriteUrls } from '../data/spriteResolver';

interface CachedGifSheet {
  textureKey: string;
  frameDelays: number[];
  frameCount: number;
  width: number;
  height: number;
}

const gifCache = new Map<string, CachedGifSheet>();
let dynamicTexCounter = 0;

async function loadAndDecodeGifToPhaser(
  scene: Phaser.Scene,
  url: string,
): Promise<CachedGifSheet> {
  const cached = gifCache.get(url);
  if (cached && scene.textures.exists(cached.textureKey)) {
    return cached;
  }

  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`GIF HTTP ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  const parsed = parseGIF(buf);
  const frames = decompressFrames(parsed, true);
  if (!frames || frames.length === 0) {
    throw new Error('Empty GIF frames');
  }

  const gifW = parsed.lsd?.width || frames[0].dims.width || 96;
  const gifH = parsed.lsd?.height || frames[0].dims.height || 96;
  const count = frames.length;

  // 限制单行宽度不超出移动端 WebGL MAX_TEXTURE_SIZE (4096)，采用网格图集排布
  const cols = Math.max(1, Math.min(count, Math.floor(2048 / gifW)));
  const rows = Math.ceil(count / cols);

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = cols * gifW;
  sheetCanvas.height = rows * gifH;
  const sheetCtx = sheetCanvas.getContext('2d')!;

  const accumCanvas = document.createElement('canvas');
  accumCanvas.width = gifW;
  accumCanvas.height = gifH;
  const accumCtx = accumCanvas.getContext('2d')!;

  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d')!;

  const frameDelays: number[] = [];

  for (let i = 0; i < count; i++) {
    const f = frames[i];
    const { width, height, left, top } = f.dims;
    let prevBackup: ImageData | null = null;
    if (f.disposalType === 3) {
      prevBackup = accumCtx.getImageData(0, 0, gifW, gifH);
    }

    patchCanvas.width = width;
    patchCanvas.height = height;
    const imgData = patchCtx.createImageData(width, height);
    imgData.data.set(f.patch);
    patchCtx.putImageData(imgData, 0, 0);

    accumCtx.drawImage(patchCanvas, left, top);

    const col = i % cols;
    const row = Math.floor(i / cols);
    sheetCtx.drawImage(accumCanvas, col * gifW, row * gifH);

    if (f.disposalType === 2) {
      accumCtx.clearRect(left, top, width, height);
    } else if (f.disposalType === 3 && prevBackup) {
      accumCtx.putImageData(prevBackup, 0, 0);
    }

    // GIF delay in gifuct-js is already in ms (or centiseconds in older builds; normalize cleanly)
    const rawDelay = f.delay || 80;
    const delayMs = rawDelay < 25 ? rawDelay * 10 : rawDelay;
    frameDelays.push(Math.max(40, Math.min(400, delayMs)));
  }

  const textureKey = `dyn_poke_gif_${++dynamicTexCounter}`;
  const canvasTex = scene.textures.addCanvas(textureKey, sheetCanvas);
  if (canvasTex) {
    canvasTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      canvasTex.add(i, 0, col * gifW, row * gifH, gifW, gifH);
    }
  }

  const entry: CachedGifSheet = {
    textureKey,
    frameDelays,
    frameCount: count,
    width: gifW,
    height: gifH,
  };
  gifCache.set(url, entry);
  return entry;
}

/**
 * 双模动态像素宝可梦演员：
 * 1. 优先使用 gifuct-js 解码为 Phaser WebGL 最近邻逐帧像素精灵；
 * 2. 若静态直连无 CORS 图床，无缝挂载像素对齐 DOM <img> 动态精灵，100% 保证全世代动态播放且零模糊。
 */
export class PixelSpriteActor {
  readonly slot: BattleSlotId;
  private scene: Phaser.Scene;
  private domLayer: HTMLElement | null;
  private anchor: SlotAnchor;

  readonly container: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Ellipse;
  private sprite: Phaser.GameObjects.Sprite;
  private hitZone: Phaser.GameObjects.Zone;
  private domImg: HTMLImageElement | null = null;

  private activeSheet: CachedGifSheet | null = null;
  private currentFrameIdx = 0;
  private frameElapsedMs = 0;
  private loadToken = 0;

  private isFlashingWhite = false;
  private statusColorHex: string | null = null;
  private teraGlowHex: string | null = null;
  private isSubstitute = false;
  private currentSpecies = '';

  constructor(
    scene: Phaser.Scene,
    slot: BattleSlotId,
    anchor: SlotAnchor,
    domLayer: HTMLElement | null,
    onTap?: (slot: BattleSlotId) => void,
  ) {
    this.scene = scene;
    this.slot = slot;
    this.anchor = { ...anchor };
    this.domLayer = domLayer;

    this.shadow = scene.add.ellipse(anchor.x, anchor.y + 2, 54 * anchor.scale, 14 * anchor.scale, 0x091017, 0.36);
    this.shadow.setDepth(anchor.depth - 2);
    this.shadow.setVisible(false);

    this.container = scene.add.container(anchor.x, anchor.y);
    this.container.setDepth(anchor.depth);
    this.container.setVisible(false);

    this.sprite = scene.add.sprite(0, 0, '__DEFAULT');
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setVisible(false);

    this.hitZone = scene.add.zone(0, -34, 70, 72);
    this.hitZone.setInteractive({ useHandCursor: true });
    if (onTap) {
      this.hitZone.on('pointerdown', () => onTap(this.slot));
    }

    this.container.add([this.sprite, this.hitZone]);
  }

  setAnchor(anchor: SlotAnchor): void {
    this.anchor = { ...anchor };
    this.container.setPosition(anchor.x, anchor.y);
    this.container.setDepth(anchor.depth);
    this.shadow.setPosition(anchor.x, anchor.y + 2);
    this.shadow.setSize(54 * anchor.scale, 14 * anchor.scale);
    this.shadow.setDepth(anchor.depth - 2);
    this.syncDomElement();
  }

  getAnchor(): SlotAnchor {
    return this.anchor;
  }

  getSpecies(): string {
    return this.currentSpecies;
  }

  async setPokemon(
    speciesName: string,
    opts: { shiny?: boolean; gender?: 'M' | 'F' | ''; animateEntry?: boolean } = {},
  ): Promise<void> {
    const token = ++this.loadToken;
    this.currentSpecies = speciesName;
    this.isFlashingWhite = false;
    this.isSubstitute = false;

    const resolved = resolvePokemonSpriteUrls(speciesName, {
      isBack: this.anchor.isBack,
      shiny: opts.shiny,
      gender: opts.gender,
    });

    let webglLoaded = false;
    for (const gifUrl of resolved.corsGifUrls) {
      try {
        const sheet = await loadAndDecodeGifToPhaser(this.scene, gifUrl);
        if (token !== this.loadToken) return;
        this.activeSheet = sheet;
        this.currentFrameIdx = 0;
        this.frameElapsedMs = 0;
        this.sprite.setTexture(sheet.textureKey, 0);
        // 对齐超大尺寸精灵（如吼鲸王/无极汰那）自适应限高，保持竖屏构图协调
        const maxPixelH = this.anchor.isBack ? 104 : 96;
        const autoFit = sheet.height > maxPixelH ? maxPixelH / sheet.height : 1;
        this.sprite.setScale(this.anchor.scale * autoFit);
        this.sprite.setVisible(true);
        this.removeDomImg();
        webglLoaded = true;
        break;
      } catch {
        // 继续尝试下一候选或平滑切换至 DOM 像素层
      }
    }

    if (!webglLoaded) {
      if (token !== this.loadToken) return;
      this.activeSheet = null;
      this.sprite.setVisible(false);
      this.mountDomFallback(resolved.allPixelUrls);
    }

    this.container.setAlpha(1);
    this.container.setScale(1);
    this.container.setPosition(this.anchor.x, this.anchor.y);
    this.container.setVisible(true);
    this.shadow.setVisible(true);

    if (opts.animateEntry !== false) {
      this.container.setScale(0.18);
      this.container.y = this.anchor.y - 12;
      this.scene.tweens.add({
        targets: this.container,
        scaleX: 1,
        scaleY: 1,
        y: this.anchor.y,
        duration: 240,
        ease: 'Back.easeOut',
      });
    }
    this.syncDomElement();
  }

  private mountDomFallback(urls: string[]): void {
    if (!this.domLayer || urls.length === 0) return;
    if (!this.domImg) {
      const img = document.createElement('img');
      img.className = 'dom-pixel-sprite';
      img.alt = this.currentSpecies;
      img.draggable = false;
      img.addEventListener('click', () => {
        this.hitZone.emit('pointerdown');
      });
      this.domLayer.appendChild(img);
      this.domImg = img;
    }

    let idx = 0;
    const tryNext = () => {
      if (!this.domImg) return;
      if (idx >= urls.length) return;
      this.domImg.src = urls[idx++];
    };
    this.domImg.onerror = () => tryNext();
    tryNext();
    this.syncDomElement();
  }

  private removeDomImg(): void {
    if (this.domImg) {
      this.domImg.remove();
      this.domImg = null;
    }
  }

  setStatusVisual(statusId: string | undefined): void {
    const map: Record<string, { tint: number; css: string }> = {
      brn: { tint: 0xffb399, css: 'sepia(0.35) saturate(1.8) hue-rotate(-25deg)' },
      psn: { tint: 0xd9a6ff, css: 'sepia(0.35) saturate(1.8) hue-rotate(235deg)' },
      tox: { tint: 0xc580ff, css: 'sepia(0.45) saturate(2.1) hue-rotate(240deg)' },
      par: { tint: 0xfff099, css: 'sepia(0.4) saturate(1.8) hue-rotate(10deg)' },
      frz: { tint: 0xa6f2ff, css: 'sepia(0.3) saturate(1.8) hue-rotate(155deg)' },
      slp: { tint: 0xb8c4d4, css: ' saturate(0.65) brightness(0.9)' },
    };
    const spec = statusId ? map[statusId] : undefined;
    if (spec && !this.isFlashingWhite) {
      this.sprite.setTint(spec.tint);
      this.statusColorHex = spec.css;
    } else {
      if (!this.isFlashingWhite) this.sprite.clearTint();
      this.statusColorHex = null;
    }
    this.syncDomElement();
  }

  setTeraGlow(glowColorCss: string | null): void {
    this.teraGlowHex = glowColorCss;
    this.syncDomElement();
  }

  setSubstitute(active: boolean): void {
    this.isSubstitute = active;
    this.container.setAlpha(active ? 0.65 : 1);
    this.syncDomElement();
  }

  playAttackLunge(targetPos: { x: number; y: number }, durationMs = 210): Promise<void> {
    const dx = (targetPos.x - this.anchor.x) * 0.28;
    const dy = (targetPos.y - this.anchor.y) * 0.28;
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.container,
        x: this.anchor.x + dx,
        y: this.anchor.y + dy,
        duration: durationMs * 0.45,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
          this.container.setPosition(this.anchor.x, this.anchor.y);
          this.syncDomElement();
          resolve();
        },
      });
    });
  }

  playHitReaction(): void {
    this.isFlashingWhite = true;
    this.sprite.setTintFill(0xffffff);
    this.syncDomElement();

    this.scene.time.delayedCall(95, () => {
      this.isFlashingWhite = false;
      this.sprite.clearTint();
      this.syncDomElement();
    });

    const dir = this.anchor.isBack ? -6 : 6;
    this.scene.tweens.add({
      targets: this.container,
      x: this.anchor.x + dir,
      duration: 45,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.container.x = this.anchor.x;
        this.syncDomElement();
      },
    });
  }

  playFaint(): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.container,
        y: this.anchor.y + 32,
        alpha: 0,
        duration: 280,
        ease: 'Quad.easeIn',
        onComplete: () => {
          this.hide();
          resolve();
        },
      });
    });
  }

  hide(): void {
    this.loadToken++;
    this.container.setVisible(false);
    this.shadow.setVisible(false);
    if (this.domImg) {
      this.domImg.style.display = 'none';
    }
  }

  update(deltaMs: number): void {
    if (this.container.visible && this.activeSheet && this.activeSheet.frameCount > 1) {
      this.frameElapsedMs += deltaMs;
      const delay = this.activeSheet.frameDelays[this.currentFrameIdx] || 80;
      if (this.frameElapsedMs >= delay) {
        this.frameElapsedMs %= delay;
        this.currentFrameIdx = (this.currentFrameIdx + 1) % this.activeSheet.frameCount;
        this.sprite.setFrame(this.currentFrameIdx);
      }
    }
    if (this.domImg) {
      this.syncDomElement();
    }
  }

  private syncDomElement(): void {
    if (!this.domImg || !this.domLayer) return;
    if (!this.container.visible) {
      this.domImg.style.display = 'none';
      return;
    }
    this.domImg.style.display = 'block';
    const pctX = (this.container.x / STAGE_WIDTH) * 100;
    const pctY = (this.container.y / STAGE_HEIGHT) * 100;
    const rect = this.domLayer.getBoundingClientRect();
    const stageRatio = rect.width > 0 ? rect.width / STAGE_WIDTH : 1.5;
    const totalScale = stageRatio * this.anchor.scale * this.container.scaleX * 0.88;

    this.domImg.style.left = `${pctX}%`;
    this.domImg.style.top = `${pctY}%`;
    this.domImg.style.opacity = String(this.container.alpha * (this.isSubstitute ? 0.65 : 1));
    this.domImg.style.zIndex = String(this.anchor.depth);
    this.domImg.style.transform = `translate(-50%, -100%) scale(${totalScale.toFixed(3)})`;

    const filters: string[] = [];
    if (this.isFlashingWhite) {
      filters.push('brightness(0) invert(1)');
    } else if (this.statusColorHex) {
      filters.push(this.statusColorHex);
    }
    if (this.teraGlowHex) {
      filters.push(`drop-shadow(0 0 4px ${this.teraGlowHex})`);
    }
    this.domImg.style.filter = filters.length > 0 ? filters.join(' ') : 'none';
  }

  destroy(): void {
    this.removeDomImg();
    this.shadow.destroy();
    this.container.destroy();
  }
}
