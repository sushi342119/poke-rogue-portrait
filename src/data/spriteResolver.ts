import { Dex, toID } from '@pkmn/dex';
import { Icons, Sprites } from '@pkmn/img';
import { ASSET_URLS } from '../config/constants';
import { getItemSlug } from './dexRegistry';

export interface ResolvedSpriteBundle {
  /** 同源/支持 CORS 的动态 GIF URL（供 gifuct-js 解码为 Phaser WebGL 动态像素纹理） */
  corsGifUrls: string[];
  /** Showdown 官方第 5 世代全图鉴动态像素 GIF + 静态像素 PNG 回退链（供 DOM 像素层或兜底加载） */
  allPixelUrls: string[];
  width: number;
  height: number;
}

function isLocalDevServer(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  return host === 'localhost' || host === '127.0.0.1' || window.location?.port === '5173';
}

/**
 * 解析宝可梦第 5 世代像素动态精灵 URL 链（严格锁定 gen5ani / gen5，绝不使用 3D 模型 ani）
 */
export function resolvePokemonSpriteUrls(
  speciesName: string,
  opts: { isBack?: boolean; shiny?: boolean; gender?: 'M' | 'F' | '' } = {},
): ResolvedSpriteBundle {
  const side = opts.isBack ? 'p1' : 'p2';
  const gender = opts.gender === 'M' || opts.gender === 'F' ? opts.gender : undefined;

  const directAni = Sprites.getPokemon(speciesName, {
    gen: 'gen5ani',
    side,
    shiny: Boolean(opts.shiny),
    gender,
    domain: ASSET_URLS.showdownDirect,
  });

  const directStatic = Sprites.getPokemon(speciesName, {
    gen: 'gen5',
    side,
    shiny: Boolean(opts.shiny),
    gender,
    domain: ASSET_URLS.showdownDirect,
  });

  const corsGifUrls: string[] = [];
  const allPixelUrls: string[] = [directAni.url];

  // PokeAPI/sprites 原生支持 Access-Control-Allow-Origin: *，为 #1~#649 基础形态提供免代理 WebGL 动态 GIF 源
  const sp = Dex.species.get(speciesName);
  if (sp.exists && !sp.forme && sp.num >= 1 && sp.num <= 649) {
    const backDir = opts.isBack ? 'back/' : '';
    const shinyDir = opts.shiny ? 'shiny/' : '';
    const pokeApiGif = `${ASSET_URLS.pokeApiSprites}/pokemon/versions/generation-v/black-white/animated/${backDir}${shinyDir}${sp.num}.gif`;
    corsGifUrls.push(pokeApiGif);
    if (!allPixelUrls.includes(pokeApiGif)) {
      allPixelUrls.push(pokeApiGif);
    }
  }

  if (!allPixelUrls.includes(directStatic.url)) {
    allPixelUrls.push(directStatic.url);
  }

  if (sp.exists && sp.num >= 1 && sp.num <= 1025) {
    const backDir = opts.isBack ? 'back/' : '';
    const shinyDir = opts.shiny ? 'shiny/' : '';
    const pokeApiPng = `${ASSET_URLS.pokeApiSprites}/pokemon/${backDir}${shinyDir}${sp.num}.png`;
    if (!allPixelUrls.includes(pokeApiPng)) {
      allPixelUrls.push(pokeApiPng);
    }
  }

  return {
    corsGifUrls,
    allPixelUrls,
    width: directAni.w || 96,
    height: directAni.h || 96,
  };
}

/**
 * 返回 Showdown 40×30 队伍迷你像素图标的内联 CSS 样式（优先走本地同步的 pokemonicons-sheet.png）
 */
export function getPokemonMiniIconStyle(speciesName: string): string {
  const icon = Icons.getPokemon(speciesName, {
    domain: ASSET_URLS.showdownDirect,
  });
  const sheetUrl = './assets/showdown/sprites/pokemonicons-sheet.png';
  return `width:40px;height:30px;display:inline-block;background:transparent url('${sheetUrl}') no-repeat scroll ${icon.left}px ${icon.top}px;image-rendering:pixelated;`;
}

/**
 * 返回 PokeAPI 全套高清像素道具图标 URL（原生 CORS *）
 */
export function getItemPixelIconUrl(itemSlugOrId: string): string {
  const slug = getItemSlug(itemSlugOrId);
  return `${ASSET_URLS.pokeApiSprites}/items/${slug}.png`;
}

export function getTrainerSpriteUrl(trainerId: string): string {
  const localTrainers = new Set([
    'hilbert',
    'hilda',
    'red',
    'blue',
    'cynthia',
    'steven',
    'n',
    'alder',
    'ghetsis',
  ]);
  const clean = trainerId.toLowerCase();
  if (localTrainers.has(clean)) {
    return `./assets/showdown/sprites/trainers/${clean}.png`;
  }
  return `${ASSET_URLS.showdownDirect}/sprites/trainers/${clean}.png`;
}

export function getPokemonCryUrl(speciesName: string): string {
  const sp = Dex.species.get(speciesName);
  let cryId = toID(sp.exists ? sp.id : speciesName);
  if (sp.exists && sp.baseSpecies && sp.forme) {
    const formeId = toID(sp.forme);
    // Showdown cries keep mega/primal/therian variants when distinct, fallback to baseSpecies on error
    if (!['megax', 'megay', 'mega', 'primal', 'therian', 'sky', 'eternal', 'unbound'].includes(formeId)) {
      cryId = toID(sp.baseSpecies);
    }
  }
  return `${ASSET_URLS.showdownDirect}/audio/cries/${cryId}.mp3`;
}

export function getPokemonFallbackCryUrl(speciesName: string): string {
  const sp = Dex.species.get(speciesName);
  const baseId = toID(sp.exists ? sp.baseSpecies || sp.id : speciesName);
  return `${ASSET_URLS.showdownDirect}/audio/cries/${baseId}.mp3`;
}
