// ==UserScript==
// @name         X 干净分享链接
// @name:en      X Clean Share Link
// @namespace    https://github.com/musewizard/x-clean-share
// @version      2.1.0
// @description  在 X（Twitter）点「分享 → 复制链接」时去掉 ?a=...&s=20 之类的追踪参数，只复制干净的推文地址。
// @description:en  Strip tracking parameters (?a=..., &s=20) from X/Twitter share links.
// @author       musewizard
// @license      MIT
// @homepageURL  https://github.com/musewizard/x-clean-share
// @supportURL   https://github.com/musewizard/x-clean-share/issues
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 配置 ================= */
  const CFG = {
    toast: true,              // 清理后右下角提示
    startupToast: true,       // 加载后提示一次（用来确认脚本真的注入成功）
    debug: true,              // 控制台输出 [XClean] 日志
    dropAllQuery: true,       // true = 推文链接的 ?... 全丢；false = 只删 trackingParams 里的
    trackingParams: ['s', 't', 'a', 'ref', 'ref_src', 'ref_url', 'src', 'cn', 'lang', 'mx'],
    extraHosts: [],           // 想顺手清理别的站点就填域名，如 ['bilibili.com']
    interceptMenu: true,      // 接管菜单里的「复制链接」点击，由脚本自己写入干净地址（最稳的一条路）
    fallbackClipboardFix: true, // 兜底：点分享按钮/菜单后读剪贴板并修正
    fallbackDelay: 400        // 兜底读取延迟(ms)
  };

  // 菜单项文案（命中即接管）。只做精确匹配，避免误伤别的菜单项
  const COPY_LABELS = ['复制链接', '複製連結', '复制帖子链接', '复制推文链接',
                       'copy link', 'copy link to post', 'copy link to tweet'];

  /* ================= 拿到页面真实 window ================= */
  // Tampermonkey 在部分配置下会把脚本放进隔离世界，此时 window/navigator 都是代理对象，
  // 直接打补丁页面无感。必须走 unsafeWindow 才能改到页面自己的对象上。
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  const isTop = (function () { try { return W.top === W; } catch (e) { return true; } })();

  /* ================= 日志 & 提示 ================= */
  const TAG = '[XClean]';
  function log() {
    if (!CFG.debug) return;
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  let toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!CFG.toast || !isTop) return;
    try {
      const doc = W.document;
      if (!toastEl || !toastEl.isConnected) {
        toastEl = doc.createElement('div');
        toastEl.style.cssText =
          'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:9px 14px;border-radius:10px;' +
          'background:rgba(15,20,25,.96);color:#e7e9ea;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
          'box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.14);' +
          'opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;' +
          'pointer-events:none;max-width:62vw;word-break:break-all;';
        (doc.body || doc.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = msg;
      requestAnimationFrame(function () {
        toastEl.style.opacity = '1';
        toastEl.style.transform = 'translateY(0)';
      });
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        if (toastEl) { toastEl.style.opacity = '0'; toastEl.style.transform = 'translateY(8px)'; }
      }, 2400);
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 核心：清洗 URL ================= */
  const X_HOST = /(^|\.)(?:x|twitter)\.com$/i;

  function isWatchedHost(h) {
    if (X_HOST.test(h)) return true;
    return CFG.extraHosts.some(function (d) { return h === d || h.endsWith('.' + d); });
  }

  // 只处理「整段文本就是一个链接」的情况，避免误伤多行复制内容
  function cleanUrl(text) {
    if (typeof text !== 'string') return text;
    const s = text.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(s)) return text;

    let u;
    try { u = new URL(s); } catch (e) { return text; }
    if (!isWatchedHost(u.hostname)) return text;

    const isStatus = /^\/[^/]+\/status\/\d+/.test(u.pathname) ||
                     /^\/i\/(?:web\/)?status\/\d+/.test(u.pathname);
    if (!isStatus) return text;

    let changed = false;
    if (u.search) {
      if (CFG.dropAllQuery) {
        u.search = '';
        changed = true;
      } else {
        CFG.trackingParams.forEach(function (p) {
          if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
        });
      }
    }
    if (u.hash) { u.hash = ''; changed = true; }
    if (!changed) return text;

    const out = u.toString();
    return out === s ? text : out;
  }

  /* ================= 打补丁的小工具 ================= */
  const hits = {}; // 记录各通道命中次数，便于诊断
  function mark(channel) {
    hits[channel] = (hits[channel] || 0) + 1;
    log('hit ->', channel);
  }

  function patchMethod(owner, prop, wrapper, channel) {
    try {
      if (!owner) return false;
      const orig = owner[prop];
      if (typeof orig !== 'function') { log('no such method', channel); return false; }
      if (orig.__xcsPatched) return true;

      const wrapped = wrapper(orig);
      if (typeof wrapped !== 'function') return false;
      wrapped.__xcsPatched = true;

      try {
        Object.defineProperty(owner, prop, {
          value: wrapped, writable: true, configurable: true, enumerable: false
        });
      } catch (e) {
        owner[prop] = wrapped;
      }
      log('patched', channel);
      return true;
    } catch (e) {
      log('patch failed', channel, e);
      return false;
    }
  }

  /* ================= 通道 1：navigator.clipboard.writeText ================= */
  function patchWriteText() {
    const proto = W.Clipboard && W.Clipboard.prototype;
    const done = patchMethod(proto, 'writeText', function (orig) {
      return function (text) {
        const cleaned = cleanUrl(text);
        if (cleaned !== text) { mark('clipboard.writeText'); toast('已移除追踪参数'); }
        return orig.call(this, cleaned);
      };
    }, 'Clipboard.prototype.writeText');
    // 再补一层实例属性（极少数环境里 writeText 被挂在实例上）
    try {
      const inst = W.navigator && W.navigator.clipboard;
      if (inst && Object.prototype.hasOwnProperty.call(inst, 'writeText') && !inst.writeText.__xcsPatched) {
        const origInst = inst.writeText;
        inst.writeText = function (text) {
          const cleaned = cleanUrl(text);
          if (cleaned !== text) { mark('clipboard.writeText(inst)'); toast('已移除追踪参数'); }
          return origInst.call(inst, cleaned);
        };
        inst.writeText.__xcsPatched = true;
        log('patched Clipboard 实例 writeText');
      }
    } catch (e) {}
    return done;
  }

  /* ================= 通道 2：navigator.clipboard.write(ClipboardItem) ================= */
  function patchWrite() {
    const proto = W.Clipboard && W.Clipboard.prototype;
    return patchMethod(proto, 'write', function (orig) {
      return function (items) {
        try {
          const list = [].slice.call(items || []);
          const jobs = list.map(function (item) {
            try {
              if (!item || !item.types || item.types.indexOf('text/plain') === -1) return Promise.resolve(item);
              return item.getType('text/plain').then(function (blob) { return blob.text(); }).then(function (txt) {
                const cleaned = cleanUrl(txt);
                if (cleaned === txt) return item;
                const parts = {};
                return Promise.all(item.types.map(function (ty) {
                  if (ty === 'text/plain') {
                    parts[ty] = new W.Blob([cleaned], { type: 'text/plain' });
                    return null;
                  }
                  return item.getType(ty).then(function (b) { parts[ty] = b; });
                })).then(function () {
                  mark('clipboard.write');
                  toast('已移除追踪参数');
                  return new W.ClipboardItem(parts);
                });
              });
            } catch (e) { return Promise.resolve(item); }
          });
          return Promise.all(jobs).then(function (out) { return orig.call(this, out); }.bind(this));
        } catch (e) {
          log('write patch fallback', e);
          return orig.call(this, items);
        }
      };
    }, 'Clipboard.prototype.write');
  }

  /* ================= 通道 3：DataTransfer.setData（copy 事件写数据的底层） ================= */
  function patchSetData() {
    const proto = W.DataTransfer && W.DataTransfer.prototype;
    return patchMethod(proto, 'setData', function (orig) {
      return function (type, data) {
        if ((type === 'text/plain' || type === 'text/uri-list') && typeof data === 'string') {
          const cleaned = cleanUrl(data);
          if (cleaned !== data) { mark('DataTransfer.setData'); toast('已移除追踪参数'); data = cleaned; }
        }
        return orig.call(this, type, data);
      };
    }, 'DataTransfer.prototype.setData');
  }

  /* ================= 通道 4：document.execCommand('copy') ================= */
  function patchExecCommand() {
    const proto = W.Document && W.Document.prototype;
    return patchMethod(proto, 'execCommand', function (orig) {
      return function (cmd) {
        const args = [].slice.call(arguments);
        const res = orig.apply(this, args);
        if (String(cmd).toLowerCase() === 'copy') {
          log('execCommand(copy) 被调用');
          setTimeout(function () { fallbackFix('execCommand'); }, 0);
        }
        return res;
      };
    }, 'Document.prototype.execCommand');
  }

  /* ================= 通道 5：copy 事件（冒泡末端兜底改写） ================= */
  function hookCopyEvent() {
    try {
      W.addEventListener('copy', function (e) {
        try {
          const dt = e.clipboardData;
          if (!dt) return;
          let raw = dt.getData('text/plain');
          // 页面没自己 setData 时，浏览器会直接复制当前选区 —— 那就从选区里取原文
          if (!raw) {
            try { raw = String(W.getSelection() || ''); } catch (err) {}
          }
          if (!raw) return;
          const cleaned = cleanUrl(raw);
          if (cleaned !== raw) {
            dt.setData('text/plain', cleaned);
            mark('copy 事件');
            toast('已移除追踪参数');
          }
        } catch (err) {}
      }, false);
      log('patched copy 事件');
    } catch (e) { log('copy hook failed', e); }
  }

  /* ================= 通道 6：navigator.share ================= */
  function patchShare() {
    try {
      const nav = W.navigator;
      if (!nav || typeof nav.share !== 'function') return false;
      const orig = nav.share;
      if (orig.__xcsPatched) return true;
      const wrapped = function (data) {
        try {
          if (data && typeof data.url === 'string') {
            const cleaned = cleanUrl(data.url);
            if (cleaned !== data.url) {
              data = Object.assign({}, data, { url: cleaned });
              mark('navigator.share');
              toast('已移除追踪参数');
            }
          }
        } catch (e) {}
        return orig.call(nav, data);
      };
      wrapped.__xcsPatched = true;
      nav.share = wrapped;
      log('patched navigator.share');
      return true;
    } catch (e) { log('share patch failed', e); return false; }
  }

  /* ================= 通道 7：直接接管「复制链接」菜单项（不依赖 JS 补丁） ================= */
  // DOM 事件在页面世界与扩展世界之间是共享的：即使在隔离世界里，捕获阶段的监听器
  // 也一定早于页面自己的处理器执行。所以这条路径最可靠 —— 拦住点击，自己写剪贴板。
  function currentTweetUrl() {
    try {
      const p = W.location.pathname;
      const a = p.match(/^\/([^/]+)\/status\/(\d+)/);
      if (a) return 'https://x.com/' + a[1] + '/status/' + a[2];
      const b = p.match(/^\/i\/(?:web\/)?status\/(\d+)/);
      if (b) return 'https://x.com/i/status/' + b[1];
    } catch (e) {}
    return null;
  }

  // 优先从被点击菜单项所属的那条推文里取链接（线程/引用推文场景才准）
  function tweetUrlFromItem(item) {
    try {
      const art = item.closest && item.closest('article');
      if (art) {
        const a = art.querySelector('a[href*="/status/"]');
        if (a) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
          if (m) return 'https://x.com/' + m[1] + '/status/' + m[2];
        }
      }
    } catch (e) {}
    return currentTweetUrl();
  }

  function findCopyMenuItem(target) {
    if (!target || !target.closest) return null;
    try {
      const mi = target.closest('[role="menuitem"],[role="button"],button,a,[data-testid="Dropdown"] div');
      if (!mi) return null;
      const txt = (mi.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (COPY_LABELS.indexOf(txt) !== -1) return mi;
    } catch (e) {}
    return null;
  }

  function hookMenuIntercept() {
    try {
      W.document.addEventListener('click', function (ev) {
        if (!CFG.interceptMenu) return;
        const item = findCopyMenuItem(ev.target);
        if (!item) return;

        const link = tweetUrlFromItem(item);
        if (!link) { log('菜单接管：拿不到推文链接，交回页面处理'); return; }

        // 拦下 X 自己的复制逻辑
        ev.preventDefault();
        ev.stopImmediatePropagation();
        mark('菜单点击接管');

        try {
          W.navigator.clipboard.writeText(link).then(function () {
            toast('已复制干净链接：' + link);
          }, function () {
            toast('复制失败，请检查剪贴板权限');
          });
        } catch (e) { log('接管写入失败', e); }

        // 顺手把菜单关掉（我们阻断了原处理器，菜单可能不会自己收）
        setTimeout(function () {
          try {
            W.document.dispatchEvent(new W.KeyboardEvent('keydown', {
              key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
            }));
          } catch (e) {}
        }, 40);
      }, true);
      log('patched 菜单点击接管');
    } catch (e) { log('menu intercept failed', e); }
  }

  /* ================= 兜底：直接读剪贴板修正 ================= */
  // 不管 X 用什么方式写入，只要我们能读到剪贴板，就能把尾巴削掉。
  // 需要浏览器授予 clipboard-read 权限（首次点击时可能弹一次授权）。
  let fixing = false;
  function fallbackFix(reason) {
    if (!CFG.fallbackClipboardFix || fixing) return;
    let clip;
    try { clip = W.navigator && W.navigator.clipboard; } catch (e) { return; }
    if (!clip || typeof clip.readText !== 'function') return;

    fixing = true;
    clip.readText().then(function (text) {
      const cleaned = cleanUrl(text);
      if (cleaned === text) { log('兜底检查：剪贴板已经是干净的'); return null; }
      log('兜底修复：', reason, '->', cleaned);
      return clip.writeText(cleaned).then(function () {
        toast('已修正剪贴板：' + cleaned);
      });
    }).catch(function (err) {
      log('兜底读取失败（可能是剪贴板权限未授予）：', err && err.name);
    }).then(function () { fixing = false; });
  }

  function hookClicks() {
    try {
      W.document.addEventListener('click', function (ev) {
        let inShareUi = false;
        try {
          const t = ev.target;
          inShareUi = !!(t && t.closest && t.closest(
            '[data-testid="Dropdown"],[data-testid="share"],[data-testid="sheetDialog"],[role="menu"]'
          ));
        } catch (e) {}
        if (!inShareUi) return;
        log('点击了分享相关 UI，安排兜底检查');
        setTimeout(function () { fallbackFix('分享UI点击'); }, CFG.fallbackDelay);
        setTimeout(function () { fallbackFix('分享UI点击(延迟2)'); }, CFG.fallbackDelay + 600);
      }, true);
    } catch (e) { log('click hook failed', e); }
  }

  /* ================= 快捷键：Ctrl/⌘ + Shift + C 复制干净链接 ================= */
  function hookHotkey() {
    try {
      W.document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
        if (String(e.key).toLowerCase() !== 'c') return;

        const p = W.location.pathname;
        let link = null;
        const a = p.match(/^\/([^/]+)\/status\/(\d+)/);
        const b = p.match(/^\/i\/(?:web\/)?status\/(\d+)/);
        if (a) link = 'https://x.com/' + a[1] + '/status/' + a[2];
        else if (b) link = 'https://x.com/i/status/' + b[1];
        if (!link) return;

        e.preventDefault();
        e.stopPropagation();
        W.navigator.clipboard.writeText(link).then(function () {
          toast('已复制：' + link);
        }, function () { toast('复制失败，请检查剪贴板权限'); });
      }, true);
    } catch (e) { log('hotkey hook failed', e); }
  }

  /* ================= 启动 ================= */
  function install() {
    patchWriteText();
    patchWrite();
    patchSetData();
    patchExecCommand();
    patchShare();
  }

  install();
  hookCopyEvent();
  hookMenuIntercept();
  hookClicks();
  hookHotkey();

  // X 是 SPA，且在部分浏览器里 Clipboard 可能晚于 document-start 出现，多补几次
  try {
    W.document.addEventListener('DOMContentLoaded', function () { install(); }, { once: true });
  } catch (e) {}
  setTimeout(install, 0);
  setTimeout(install, 500);
  setTimeout(install, 2000);
  setTimeout(install, 5000);

  if (CFG.startupToast) {
    setTimeout(function () {
      // 自检：补丁是否真的挂在页面对象上（隔离世界失败时这里会是 false）
      let ok = false;
      try {
        const p = W.Clipboard && W.Clipboard.prototype;
        ok = !!(p && p.writeText && p.writeText.__xcsPatched);
      } catch (e) {}
      log('自检 patched =', ok);
      toast(ok ? 'X 干净链接 v2.1 已生效'
               : 'X 干净链接：已注入，但补丁未挂到页面（仍可点「复制链接」由菜单接管兜底）');
    }, 900);
  }

  // 诊断入口：控制台 __xcs.state()
  try {
    W.__xcs = {
      version: '2.0.0',
      clean: cleanUrl,
      state: function () { log('hits =', hits); return { hits: hits, patched: true }; }
    };
  } catch (e) {}

  log('已注入，world =', (W === window ? 'page/same' : 'page(unsafeWindow)'));
})();
