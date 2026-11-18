import Phaser from 'phaser';
import {
  BIOMES,
  DOUBLES_ANCHORS,
  ENDGAME_BIOME,
  SINGLES_ANCHORS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type BattleSlotId,
  type BiomeConfig,
} from '../config/constants';
import { VFX_SHEETS, getMoveVisualProfile } from '../data/moveVfxRegistry';
import { audioEngine } from '../audio/AudioEngine';
import { PixelSpriteActor } from './PixelSpriteActor';

export interface FloatingTagOptions {
  text: string;
  color?: string;
  subText?: string;
  scale?: number;
}

/**
 * 270×256 竖屏像素战斗舞台（Phaser 3 WebGL/Canvas 最近邻渲染）
 * 负责：分层生态场地、1v1/2v2 错位站位、18 属性像素技能打击动画、Showdown 飘字、精灵球投掷与进化光效
 */
export class BattleScene extends Phaser.Scene {
  private skyRect!: Phaser.GameObjects.Rectangle;
  private groundRect!: Phaser.GameObjects.Rectangle;
  private arenaBg!: Phaser.GameObjects.Image;
  private arenaEnemyBase!: Phaser.GameObjects.Image;
  private arenaPlayerBase!: Phaser.GameObjects.Image;
  private weatherOverlay!: Phaser.GameObjects.Graphics;

  private actors = new Map<BattleSlotId, PixelSpriteActor>();
  private isDoubles = false;
  private currentBiome: BiomeConfig = BIOMES[0];
  private activeWeather = '';
  private weatherTick = 0;
  private speedMultiplier = 1;
  private domLayer: HTMLElement | null = null;
  private onSlotTapCallback?: (slot: BattleSlotId) => void;
  private readyResolvers: (() => void)[] = [];
  private isSceneReady = false;

  constructor() {
    super({ key: 'BattleScene' });
  }

  setOnSlotTapped(cb: (slot: BattleSlotId) => void): void {
    this.onSlotTapCallback = cb;
  }

  setSpeedMultiplier(mult: number): void {
    this.speedMultiplier = Math.max(1, mult);
    if (this.tweens) {
      this.tweens.timeScale = this.speedMultiplier;
    }
    if (this.anims) {
      this.anims.globalTimeScale = this.speedMultiplier;
    }
  }

  whenReady(): Promise<void> {
    if (this.isSceneReady) return Promise.resolve();
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  preload(): void {
    const allBiomes = [...BIOMES, ENDGAME_BIOME];
    const loadedKeys = new Set<string>();
    for (const b of allBiomes) {
      if (loadedKeys.has(b.arenaKey)) continue;
      loadedKeys.add(b.arenaKey);
      this.load.image(`${b.arenaKey}_bg`, `./assets/pr/arenas/${b.arenaKey}_bg.png`);
      this.load.image(`${b.arenaKey}_a`, `./assets/pr/arenas/${b.arenaKey}_a.png`);
      this.load.image(`${b.arenaKey}_b`, `./assets/pr/arenas/${b.arenaKey}_b.png`);
    }

    for (const ball of ['pb', 'gb', 'ub', 'mb']) {
      this.load.image(`ball_${ball}`, `./assets/pr/pokeball/${ball}.png`);
      this.load.image(`ball_${ball}_opening`, `./assets/pr/pokeball/${ball}_opening.png`);
      this.load.image(`ball_${ball}_open`, `./assets/pr/pokeball/${ball}_open.png`);
    }

    for (const spec of Object.values(VFX_SHEETS)) {
      this.load.spritesheet(`vfx_${spec.key}`, spec.url, {
        frameWidth: spec.frameWidth,
        frameHeight: spec.frameHeight,
      });
    }
  }

  create(): void {
    this.domLayer = document.getElementById('sprite-dom-layer');

    // 1. 顶部天空与底部地面整数像素延展色块（保证 320×180 原始像素背景 1:1 不做非整数变形）
    this.skyRect = this.add
      .rectangle(0, 0, STAGE_WIDTH, 60, 0x6ec0f0)
      .setOrigin(0, 0)
      .setDepth(0);
    this.groundRect = this.add
      .rectangle(0, 196, STAGE_WIDTH, STAGE_HEIGHT - 196, 0x7ec46c)
      .setOrigin(0, 0)
      .setDepth(1);

    this.arenaBg = this.add.image(-25, 28, 'plains_bg').setOrigin(0, 0).setDepth(2);
    this.arenaEnemyBase = this.add.image(-30, 34, 'plains_b').setOrigin(0, 0).setDepth(5);
    this.arenaPlayerBase = this.add
      .image(-18, STAGE_HEIGHT - 132, 'plains_a')
      .setOrigin(0, 0)
      .setDepth(6);

    this.weatherOverlay = this.add.graphics().setDepth(65);

    // 2. 初始化 4 个战斗站位演员
    const slots: BattleSlotId[] = ['p1a', 'p1b', 'p2a', 'p2b'];
    for (const slot of slots) {
      const anchor = DOUBLES_ANCHORS[slot];
      const actor = new PixelSpriteActor(this, slot, anchor, this.domLayer, (s) => {
        this.onSlotTapCallback?.(s);
      });
      this.actors.set(slot, actor);
    }
    this.setFormation(false);
    this.applyBiome(BIOMES[0]);

    this.isSceneReady = true;
    for (const resolve of this.readyResolvers.splice(0)) {
      resolve();
    }
  }

  setFormation(isDoubles: boolean): void {
    this.isDoubles = isDoubles;
    if (isDoubles) {
      for (const slot of ['p1a', 'p1b', 'p2a', 'p2b'] as BattleSlotId[]) {
        this.actors.get(slot)?.setAnchor(DOUBLES_ANCHORS[slot]);
      }
    } else {
      this.actors.get('p1a')?.setAnchor(SINGLES_ANCHORS.p1a);
      this.actors.get('p2a')?.setAnchor(SINGLES_ANCHORS.p2a);
      this.actors.get('p1b')?.hide();
      this.actors.get('p2b')?.hide();
    }
  }

  applyBiome(biome: BiomeConfig): void {
    this.currentBiome = biome;
    if (!this.skyRect) return;
    this.skyRect.setFillStyle(Phaser.Display.Color.HexStringToColor(biome.skyTop).color);
    this.groundRect.setFillStyle(Phaser.Display.Color.HexStringToColor(biome.groundTint).color);

    const key = biome.arenaKey;
    if (this.textures.exists(`${key}_bg`)) this.arenaBg.setTexture(`${key}_bg`);
    if (this.textures.exists(`${key}_b`)) this.arenaEnemyBase.setTexture(`${key}_b`);
    if (this.textures.exists(`${key}_a`)) this.arenaPlayerBase.setTexture(`${key}_a`);
  }

  setWeather(weatherId: string): void {
    this.activeWeather = weatherId;
    if (!weatherId && this.weatherOverlay) {
      this.weatherOverlay.clear();
    }
  }

  getActor(slot: BattleSlotId): PixelSpriteActor | undefined {
    return this.actors.get(slot);
  }

  clearAllActors(): void {
    for (const actor of this.actors.values()) {
      actor.hide();
    }
    this.setWeather('');
  }

  /**
   * Showdown 标志性头顶飘字（如 -48% / 效果绝佳! / 物攻 +1 / 免疫）
   */
  showFloatingPopup(slot: BattleSlotId, opts: FloatingTagOptions): void {
    if (!this.domLayer) return;
    const actor = this.actors.get(slot);
    if (!actor) return;
    const anchor = actor.getAnchor();

    const tag = document.createElement('div');
    tag.className = 'sd-floating-popup';
    tag.style.left = `${((anchor.x / STAGE_WIDTH) * 100).toFixed(1)}%`;
    tag.style.top = `${(((anchor.y - 44) / STAGE_HEIGHT) * 100).toFixed(1)}%`;
    if (opts.color) {
      tag.style.color = opts.color;
    }
    tag.innerHTML = opts.subText
      ? `<strong>${opts.text}</strong><span>${opts.subText}</span>`
      : `<strong>${opts.text}</strong>`;

    this.domLayer.appendChild(tag);
    window.setTimeout(() => {
      tag.remove();
    }, Math.max(380, Math.round(920 / this.speedMultiplier)));
  }

  /**
   * 播放 18 属性像素技能打击特效与震屏反馈
   */
  async playMoveVfx(
    attackerSlot: BattleSlotId,
    targetSlots: BattleSlotId[],
    moveId: string,
    effectiveness = 1,
  ): Promise<void> {
    if (this.speedMultiplier >= 4) return;
    const attacker = this.actors.get(attackerSlot);
    const primaryTarget = this.actors.get(targetSlots[0] || attackerSlot);
    if (!attacker || !primaryTarget) return;

    const profile = getMoveVisualProfile(moveId);
    const atkAnchor = attacker.getAnchor();
    const defAnchor = primaryTarget.getAnchor();

    if (profile.motion === 'self') {
      audioEngine.playUiSfx('statUp');
      await this.spawnSpriteSheetBurst(atkAnchor.x, atkAnchor.y - 28, profile);
      return;
    }

    if (profile.motion === 'lunge') {
      const lungePromise = attacker.playAttackLunge(defAnchor, 200 / this.speedMultiplier);
      await this.delay(85);
      audioEngine.playHitSfx(effectiveness);
      await Promise.all([
        lungePromise,
        ...targetSlots.map((s) => {
          const t = this.actors.get(s);
          if (!t) return Promise.resolve();
          t.playHitReaction();
          const a = t.getAnchor();
          return this.spawnSpriteSheetBurst(a.x, a.y - 28, profile);
        }),
      ]);
    } else if (profile.motion === 'projectile') {
      await this.playProjectileStream(atkAnchor, defAnchor, profile.tint || 0xffffff);
      audioEngine.playHitSfx(effectiveness);
      await Promise.all(
        targetSlots.map((s) => {
          const t = this.actors.get(s);
          if (!t) return Promise.resolve();
          t.playHitReaction();
          const a = t.getAnchor();
          return this.spawnSpriteSheetBurst(a.x, a.y - 28, profile);
        }),
      );
    } else {
      // spread / target
      audioEngine.playHitSfx(effectiveness);
      await Promise.all(
        targetSlots.map((s) => {
          const t = this.actors.get(s);
          if (!t) return Promise.resolve();
          t.playHitReaction();
          const a = t.getAnchor();
          return this.spawnSpriteSheetBurst(a.x, a.y - 28, profile);
        }),
      );
    }

    if (profile.screenShake > 0) {
      this.cameras.main.shake(
        Math.round(110 / this.speedMultiplier),
        0.003 * profile.screenShake,
      );
    }
  }

  private playProjectileStream(
    from: { x: number; y: number },
    to: { x: number; y: number },
    tint: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const orb = this.add.circle(from.x, from.y - 28, 7, tint, 0.95).setDepth(58);
      const core = this.add.circle(from.x, from.y - 28, 3.5, 0xffffff, 1).setDepth(59);
      this.tweens.add({
        targets: [orb, core],
        x: to.x,
        y: to.y - 28,
        duration: Math.max(70, Math.round(175 / this.speedMultiplier)),
        ease: 'Sine.easeIn',
        onComplete: () => {
          orb.destroy();
          core.destroy();
          resolve();
        },
      });
    });
  }

  private spawnSpriteSheetBurst(
    x: number,
    y: number,
    profile: ReturnType<typeof getMoveVisualProfile>,
  ): Promise<void> {
    const texKey = `vfx_${profile.sheet}`;
    if (!this.textures.exists(texKey)) {
      return this.delay(120);
    }

    return new Promise((resolve) => {
      const animKey = `anim_${profile.sheet}_${profile.startFrame}_${profile.endFrame}`;
      if (!this.anims.exists(animKey)) {
        const maxFrame = Math.min(
          profile.endFrame,
          VFX_SHEETS[profile.sheet].totalFrames - 1,
        );
        this.anims.create({
          key: animKey,
          frames: this.anims.generateFrameNumbers(texKey, {
            start: profile.startFrame,
            end: maxFrame,
          }),
          frameRate: profile.fps,
          repeat: 0,
        });
      }

      const fx = this.add.sprite(x, y, texKey, profile.startFrame);
      fx.setDepth(60);
      fx.setScale(profile.scale * 0.85);
      if (profile.tint) {
        fx.setTint(profile.tint);
      }
      fx.once('animationcomplete', () => {
        fx.destroy();
        resolve();
      });
      fx.play(animKey);
    });
  }

  /**
   * 肉鸽野生收服：精灵球抛物线投掷、吸收、摇晃 1~3 次与捕获成功/挣脱完整演出
   */
  async playPokeballCaptureSequence(
    ballTier: 'pb' | 'gb' | 'ub' | 'mb',
    shakes: number,
    caught: boolean,
  ): Promise<void> {
    const enemyActor = this.actors.get('p2a');
    if (!enemyActor) return;
    const target = enemyActor.getAnchor();

    const ball = this.add.image(42, STAGE_HEIGHT - 32, `ball_${ballTier}`).setDepth(62).setScale(1.35);
    audioEngine.playUiSfx('ballThrow');

    // 1. 抛物线飞向野生宝可梦
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: ball,
        x: target.x,
        y: target.y - 34,
        angle: 360,
        duration: Math.round(320 / this.speedMultiplier),
        ease: 'Quad.easeOut',
        onComplete: () => resolve(),
      });
    });

    // 2. 打开球盖，红光收入宝可梦
    ball.setTexture(`ball_${ballTier}_open`);
    enemyActor.container.setScale(0.2);
    enemyActor.container.setAlpha(0);
    enemyActor.update(0);
    await this.delay(140);
    ball.setTexture(`ball_${ballTier}`);

    // 3. 落地弹跳
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: ball,
        y: target.y - 4,
        duration: Math.round(240 / this.speedMultiplier),
        ease: 'Bounce.easeOut',
        onComplete: () => resolve(),
      });
    });

    // 4. 摇晃判定 (1~3 次)
    const shakeCount = Math.max(1, Math.min(3, shakes));
    for (let i = 0; i < shakeCount; i++) {
      await this.delay(240);
      audioEngine.playUiSfx('ballShake');
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: ball,
          angle: i % 2 === 0 ? -24 : 24,
          duration: Math.round(90 / this.speedMultiplier),
          yoyo: true,
          onComplete: () => {
            ball.setAngle(0);
            resolve();
          },
        });
      });
    }

    await this.delay(220);

    if (caught) {
      ball.setTint(0x99aab5);
      audioEngine.playUiSfx('ballCatch');
      this.showFloatingPopup('p2a', { text: '✨ 收服成功！', color: '#ffe066' });
      await this.delay(520);
      ball.destroy();
    } else {
      ball.setTexture(`ball_${ballTier}_open`);
      audioEngine.playUiSfx('cancel');
      enemyActor.container.setScale(1);
      enemyActor.container.setAlpha(1);
      enemyActor.update(0);
      this.showFloatingPopup('p2a', { text: '挣脱了！', color: '#ff8a80' });
      await this.delay(180);
      ball.destroy();
    }
  }

  /**
   * 像素白光进化演出
   */
  async playEvolutionMorph(
    slot: BattleSlotId,
    newSpeciesName: string,
    shiny = false,
  ): Promise<void> {
    const actor = this.actors.get(slot);
    if (!actor) return;
    audioEngine.playLocalSe('level_up.wav', 'statUp');
    const flash = this.add
      .rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0xffffff, 0)
      .setOrigin(0, 0)
      .setDepth(70);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: flash,
        alpha: 0.88,
        duration: 260,
        yoyo: true,
        onYoyo: () => {
          actor.setPokemon(newSpeciesName, { shiny, animateEntry: true });
        },
        onComplete: () => {
          flash.destroy();
          resolve();
        },
      });
    });
    audioEngine.playCry(newSpeciesName, false);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(Math.max(16, Math.round(ms / this.speedMultiplier)), () => resolve());
    });
  }

  update(_time: number, delta: number): void {
    for (const actor of this.actors.values()) {
      actor.update(delta * this.speedMultiplier);
    }
    this.renderWeatherParticles(delta);
  }

  private renderWeatherParticles(delta: number): void {
    if (!this.activeWeather || !this.weatherOverlay) return;
    this.weatherTick += delta * 0.06;
    this.weatherOverlay.clear();

    const w = this.activeWeather.toLowerCase();
    if (w.includes('rain') || w.includes('primordial')) {
      this.weatherOverlay.lineStyle(1, 0x8cc8ff, 0.52);
      for (let i = 0; i < 18; i++) {
        const x = ((i * 37 + this.weatherTick * 18) % (STAGE_WIDTH + 30)) - 15;
        const y = (i * 29 + this.weatherTick * 32) % STAGE_HEIGHT;
        this.weatherOverlay.lineBetween(x, y, x - 4, y + 10);
      }
    } else if (w.includes('sun') || w.includes('desolate')) {
      this.weatherOverlay.fillStyle(0xffe484, 0.14);
      const pulse = Math.sin(this.weatherTick * 0.35) * 8;
      this.weatherOverlay.fillCircle(STAGE_WIDTH - 24, 22, 34 + pulse);
    } else if (w.includes('sand')) {
      this.weatherOverlay.fillStyle(0xe0b56b, 0.48);
      for (let i = 0; i < 22; i++) {
        const x = (i * 41 + this.weatherTick * 26) % STAGE_WIDTH;
        const y = (i * 19 + Math.sin(this.weatherTick * 0.4 + i) * 12 + 120) % STAGE_HEIGHT;
        this.weatherOverlay.fillRect(x, y, 2, 2);
      }
    } else if (w.includes('snow') || w.includes('hail')) {
      this.weatherOverlay.fillStyle(0xffffff, 0.72);
      for (let i = 0; i < 18; i++) {
        const x = (i * 31 + Math.sin(this.weatherTick * 0.2 + i) * 10 + STAGE_WIDTH) % STAGE_WIDTH;
        const y = (i * 23 + this.weatherTick * 10) % STAGE_HEIGHT;
        this.weatherOverlay.fillRect(x, y, 2, 2);
      }
    }
  }
}
