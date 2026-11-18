#!/usr/bin/env node
/**
 * PokéRogue Portrait 安卓 APK 原生工程定制与像素桌面图标生成脚本
 *
 * 在 `npx cap add android` 生成 `android/` 目录后自动执行：
 * 1. 纯 Node (zlib) 生成全套分辨率像素风精灵球爬塔图标 (mdpi~xxxhdpi + Adaptive Foreground)
 * 2. 锁定 AndroidManifest.xml 竖屏方向 (portrait) 与网络权限
 * 3. 定制沉浸式深色状态栏与导航栏 (#0d131a)，消除冷启动白屏
 * 4. 注入版本号 (versionCode / versionName) 与 MainActivity 原生音频免手势/返回手势安全桥接
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ANDROID_DIR = process.env.ANDROID_PROJECT_DIR
  ? path.resolve(process.env.ANDROID_PROJECT_DIR)
  : path.join(ROOT_DIR, 'android');

// ─── CRC32 & Pure Node RGBA PNG Encoder ──────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 16×16 像素黄金王冠大师球爬塔徽章矩阵
const PIXEL_ART_16 = [
  '......YYYY......',
  '....YYGGGGYY....',
  '...KRRRRRRRRK...',
  '..KRRWWWRRRRRK..',
  '.KRRWWRRRRRRRRK.',
  '.KRRRRRRRRRRRRK.',
  'KRRRRRRKKRRRRRRK',
  'KKKKKKKWWKKKKKKK',
  'KKKKKKKWWKKKKKKK',
  'KWWWWWWKKWWWWWWK',
  '.KWWWWWWWWWWWWK.',
  '.KWWSSSSSSSSWWK.',
  '..KWWWWWWWWWWK..',
  '...KSSSSSSSSK...',
  '....KKKKKKKK....',
  '................',
];

const PALETTE = {
  '.': [0, 0, 0, 0],
  K: [18, 24, 34, 255],      // 像素描边墨黑
  R: [228, 64, 58, 255],     // 经典红球上半盖
  Y: [255, 214, 74, 255],    // 爬塔王冠金高光
  G: [236, 158, 36, 255],    // 王冠琥珀金
  W: [246, 250, 255, 255],   // 亮白高光与球轴
  S: [186, 201, 219, 255],   // 下半球立体冷灰阴影
};

function renderLauncherPng(size, mode = 'square') {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const bg = [20, 27, 36, 255]; // #141b24
  const border = [46, 66, 92, 255];
  const half = size / 2;
  const cornerR = size * 0.22;

  // 1. 绘制背景底座（foreground 模式保持透明背景）
  if (mode !== 'foreground') {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let inside = true;
        let isEdge = false;
        if (mode === 'round') {
          const dist = Math.hypot(x + 0.5 - half, y + 0.5 - half);
          inside = dist <= half - 0.5;
          isEdge = inside && dist >= half - Math.max(1.5, size * 0.03);
        } else {
          const dx = Math.max(Math.abs(x + 0.5 - half) - (half - cornerR), 0);
          const dy = Math.max(Math.abs(y + 0.5 - half) - (half - cornerR), 0);
          const dist = Math.hypot(dx, dy);
          inside = dist <= cornerR;
          isEdge = inside && dist >= cornerR - Math.max(1.5, size * 0.03);
        }
        if (inside) {
          const idx = (y * size + x) * 4;
          const col = isEdge ? border : bg;
          rgba[idx] = col[0];
          rgba[idx + 1] = col[1];
          rgba[idx + 2] = col[2];
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  // 2. 绘制居中最近邻整数缩放 16×16 像素徽章（Adaptive Foreground 严格控制在中间 60% 安全区内）
  const targetSpan = mode === 'foreground' ? size * 0.56 : size * 0.72;
  const scale = Math.max(1, Math.floor(targetSpan / 16));
  const artSpan = scale * 16;
  const offsetX = Math.floor((size - artSpan) / 2);
  const offsetY = Math.floor((size - artSpan) / 2);

  for (let py = 0; py < 16; py++) {
    const row = PIXEL_ART_16[py];
    for (let px = 0; px < 16; px++) {
      const col = PALETTE[row[px]];
      if (!col || col[3] === 0) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const tx = offsetX + px * scale + sx;
          const ty = offsetY + py * scale + sy;
          if (tx < 0 || tx >= size || ty < 0 || ty >= size) continue;
          const idx = (ty * size + tx) * 4;
          rgba[idx] = col[0];
          rgba[idx + 1] = col[1];
          rgba[idx + 2] = col[2];
          rgba[idx + 3] = col[3];
        }
      }
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

async function generateIcons(resDir) {
  const densities = [
    { dir: 'mipmap-mdpi', launcher: 48, fg: 108 },
    { dir: 'mipmap-hdpi', launcher: 72, fg: 162 },
    { dir: 'mipmap-xhdpi', launcher: 96, fg: 216 },
    { dir: 'mipmap-xxhdpi', launcher: 144, fg: 324 },
    { dir: 'mipmap-xxxhdpi', launcher: 192, fg: 432 },
  ];

  for (const d of densities) {
    const folder = path.join(resDir, d.dir);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'ic_launcher.png'), renderLauncherPng(d.launcher, 'square'));
    await fs.writeFile(path.join(folder, 'ic_launcher_round.png'), renderLauncherPng(d.launcher, 'round'));
    await fs.writeFile(path.join(folder, 'ic_launcher_foreground.png'), renderLauncherPng(d.fg, 'foreground'));
  }

  const bgXmlPath = path.join(resDir, 'values', 'ic_launcher_background.xml');
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#141b24</color>
</resources>
`;
  await fs.mkdir(path.dirname(bgXmlPath), { recursive: true });
  await fs.writeFile(bgXmlPath, bgXml, 'utf8');
  console.log('✓ 已生成全套像素风桌面图标 (mdpi ~ xxxhdpi + Adaptive Icon)');
}

async function patchManifest(manifestPath) {
  let xml = await fs.readFile(manifestPath, 'utf8');
  if (!xml.includes('android:screenOrientation=')) {
    xml = xml.replace(
      'android:name=".MainActivity"',
      'android:name=".MainActivity"\n            android:screenOrientation="portrait"',
    );
  }
  if (!xml.includes('android.permission.INTERNET')) {
    xml = xml.replace(
      '</manifest>',
      '    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>',
    );
  }
  await fs.writeFile(manifestPath, xml, 'utf8');
  console.log('✓ 已锁定 AndroidManifest.xml 竖屏方向 (portrait)');
}

async function patchStyles(stylesPath) {
  let xml = await fs.readFile(stylesPath, 'utf8');
  if (!xml.includes('android:statusBarColor')) {
    xml = xml.replace(
      /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
      `$1
        <item name="android:statusBarColor">#0d131a</item>
        <item name="android:navigationBarColor">#0d131a</item>
        <item name="android:windowBackground">#0d131a</item>`,
    );
    await fs.writeFile(stylesPath, xml, 'utf8');
  }
  console.log('✓ 已定制沉浸式深色状态栏与导航栏 (#0d131a)');
}

async function patchBuildGradle(gradlePath) {
  const versionCode = Number(process.env.APK_VERSION_CODE || 200);
  const versionName = process.env.APK_VERSION_NAME || '2.0.0';
  let gradle = await fs.readFile(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
  await fs.writeFile(gradlePath, gradle, 'utf8');
  console.log(`✓ 已写入 APK 版本号 versionName=${versionName} (versionCode=${versionCode})`);
}

async function patchMainActivity(javaPath) {
  const javaCode = `package com.pokerogue.portrait;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            webView.setBackgroundColor(Color.parseColor("#0d131a"));
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "(function(){ return window.__handleAndroidBack ? window.__handleAndroidBack() : 'root'; })()",
                        value -> {
                            if (value == null || !value.contains("handled")) {
                                moveTaskToBack(true);
                            }
                        }
                    );
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
`;
  await fs.mkdir(path.dirname(javaPath), { recursive: true });
  await fs.writeFile(javaPath, javaCode, 'utf8');
  console.log('✓ 已注入 MainActivity 原生音频免手势与防误退后台保护');
}

async function main() {
  const mainDir = path.join(ANDROID_DIR, 'app', 'src', 'main');
  await generateIcons(path.join(mainDir, 'res'));
  await patchManifest(path.join(mainDir, 'AndroidManifest.xml'));
  await patchStyles(path.join(mainDir, 'res', 'values', 'styles.xml'));
  await patchBuildGradle(path.join(ANDROID_DIR, 'app', 'build.gradle'));
  await patchMainActivity(
    path.join(mainDir, 'java', 'com', 'pokerogue', 'portrait', 'MainActivity.java'),
  );
}

main().catch((err) => {
  console.error('customize-android 失败:', err);
  process.exit(1);
});
