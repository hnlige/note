#!/usr/bin/env node
/**
 * 线上环境浏览器自动登录验证
 *
 * 说明：duban 的登录态不是 cookie，而是登录接口返回的 JWT（放在响应体 JSON 的 `token` 字段里），
 * 前端写入 localStorage['duban-auth-token']，之后每个请求通过 `Authorization: Bearer <token>` 头携带。
 * 所以 `curl -c/-b cookiejar` 永远拿不到 token（它只认 Set-Cookie 头），后续请求必然 401。
 * 本脚本用真实浏览器走完整 UI 登录流程，验证“登录态确实能在浏览器里建立并保持”，
 * 并额外用一个受保护接口确认 token 真实可用。
 *
 * 用法：
 *   # 探针模式（无需凭证，只验证登录页可达、表单能渲染）
 *   node scripts/prod-login-check.mjs probe
 *
 *   # 登录模式（用真实账号做完整 UI 登录并断言登录态）
 *   DUBAN_USERNAME=xxx DUBAN_PASSWORD=yyy node scripts/prod-login-check.mjs login
 *   # 或交互式输入密码（不会回显）：
 *   DUBAN_USERNAME=xxx node scripts/prod-login-check.mjs login
 *
 * 输出：截图 outputs/prod-login-*.png + JSON 报告 outputs/prod-login-report.json
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

/** 优先复用本机已安装的 Chrome/Chromium，避免下载 Playwright 自带浏览器（该环境常无法访问 CDN） */
function resolveExecutablePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/opt/homebrew/opt/chromium/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const BASE_URL = process.env.DUBAN_BASE_URL || 'http://49.233.13.110';
const USERNAME = process.env.DUBAN_USERNAME || '';
const PASSWORD = process.env.DUBAN_PASSWORD || '';
const OUT_DIR = resolve(process.cwd(), 'outputs');
const mode = process.argv[2] || (USERNAME && PASSWORD ? 'login' : 'probe');

mkdirSync(OUT_DIR, { recursive: true });

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function getReleaseId() {
  try {
    const r = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return j?.releaseId || null;
  } catch {
    return null;
  }
}

/** 交互式隐藏输入密码（stdin raw mode，不回显） */
function promptPassword(question) {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);
    process.stdin.setRawMode?.(true);
    let buf = '';
    const onData = (ch) => {
      const s = ch.toString('utf8');
      if (s === '\n' || s === '\r' || s === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolvePromise(buf);
        return;
      }
      if (s === '\u0003') { process.exit(1); }
      if (s === '\u007f' || s === '\b') { buf = buf.slice(0, -1); return; }
      buf += s;
    };
    process.stdin.on('data', onData);
  });
}

async function run() {
  const report = {
    mode,
    baseUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    releaseId: await getReleaseId(),
    steps: [],
    passed: false,
    error: null,
  };
  const step = (name, ok, detail) => {
    report.steps.push({ name, ok, detail: detail ?? null });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const execPath = resolveExecutablePath();
  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (execPath) {
    launchOpts.executablePath = execPath;
    console.log(`ℹ️  使用本机浏览器: ${execPath}`);
  } else {
    console.log('ℹ️  使用 Playwright 自带 chromium（请确保已执行 npx playwright install chromium）');
  }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const screenshotPath = resolve(OUT_DIR, `prod-login-${ts()}.png`);

  try {
    // 1) 打开登录页
    const resp = await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    step('登录页可达', !!resp && resp.status() < 400, `HTTP ${resp?.status()}`);

    // 2) 表单渲染
    const account = page.getByPlaceholder('请输入账号');
    const pwd = page.getByPlaceholder('请输入密码');
    await account.waitFor({ state: 'visible', timeout: 10000 });
    step('登录表单渲染', (await account.isVisible()) && (await pwd.isVisible()));

    if (mode !== 'login') {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      step('探针截图已保存', true, screenshotPath);
      report.passed = true;
      return report;
    }

    // ---- 登录模式 ----
    let pass = PASSWORD;
    if (!pass) pass = await promptPassword('请输入密码（不回显）: ');
    if (!USERNAME || !pass) {
      report.error = '缺少 DUBAN_USERNAME / DUBAN_PASSWORD';
      step('凭证完整', false, report.error);
      return report;
    }

    await account.fill(USERNAME);
    await pwd.fill(pass);
    step('填充账号密码', true, `username=${USERNAME}`);

    await page.getByRole('button', { name: /登录/ }).click();

    // 3) 等待登录态建立（localStorage 写入 token，且离开 /login）
    let token = null;
    try {
      await page.waitForFunction(
        () => {
          try { return !!localStorage.getItem('duban-auth-token'); } catch { return false; }
        },
        { timeout: 20000 },
      );
      token = await page.evaluate(() => localStorage.getItem('duban-auth-token'));
      step('登录态已建立(localStorage token)', !!token, token ? `len=${token.length}` : 'null');
    } catch {
      // 可能登录失败，尝试读取错误提示
      const errText = await page.locator('.bg-red-50, text=账号或密码').first().textContent().catch(() => '');
      step('登录态已建立(localStorage token)', false, errText?.trim() || '超时未写入 token（可能账号密码错误/被限流）');
      report.error = errText?.trim() || '登录失败';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      report.screenshot = screenshotPath;
      return report;
    }

    // 4) 跳转到落地页
    const url = page.url();
    const leftLogin = !url.includes('/login');
    step('已离开登录页', leftLogin, url);
    report.landingUrl = url;

    // 5) token 结构校验（非过期）
    let tokenOk = false;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
      const exp = payload.exp ? payload.exp * 1000 : 0;
      tokenOk = !!payload.id && !!payload.username && exp > Date.now();
      step('token 结构有效', tokenOk, `user=${payload.username} exp=${payload.exp ? new Date(exp).toISOString() : 'n/a'}`);
    } catch {
      step('token 结构有效', false, 'token 解析失败');
    }

    // 6) 用 token 调一个受保护接口，确认真实可用
    const apiCheck = await page.evaluate(async () => {
      const t = localStorage.getItem('duban-auth-token');
      const r = await fetch('/api/items?pageSize=1', { headers: { Authorization: `Bearer ${t}` } });
      return { status: r.status, ok: r.ok };
    });
    step('受保护接口可用(/api/items)', apiCheck.ok, `HTTP ${apiCheck.status}`);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    step('登录后截图已保存', true, screenshotPath);

    report.passed = leftLogin && tokenOk && apiCheck.ok;
    report.screenshot = screenshotPath;
    return report;
  } catch (e) {
    report.error = String(e?.stack || e);
    step('执行异常', false, String(e?.message || e));
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); report.screenshot = screenshotPath; } catch {}
    return report;
  } finally {
    await browser.close();
  }
}

run().then((report) => {
  const jsonPath = resolve(OUT_DIR, 'prod-login-report.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n=== 结果: ${report.passed ? 'PASS' : 'FAIL'} ===`);
  console.log(`报告: ${jsonPath}`);
  if (report.screenshot) console.log(`截图: ${report.screenshot}`);
  process.exit(report.passed ? 0 : 1);
}).catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
