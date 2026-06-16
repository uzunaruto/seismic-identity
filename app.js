/* =========================================================
   Seismic Signatures - app.js
   No framework, no build. Pure vanilla.
   - 7 founding members w/ distinct marks
   - 3 card themes (tremor / obsidian / fossil)
   - signature canvas + handle input -> preview
   - claim flow (mock: stores in localStorage, emits telemetry)
   - mint collection with pagination
   - marquee, terminal live telemetry, members bento
   ========================================================= */

(() => {
  'use strict';

  // ---------------- data ----------------
  // 7 founding members, distinct roles & addresses
  const FOUNDING_MEMBERS = [
    { handle: 'archanist.eth', role: 'Founder seal', addr: '0x6a6072efd67b52a2f1accd5f0d3f37c6e289b51a', mark: 'rock' },
    { handle: 'tremor.wave.eth', role: 'Validator', addr: '0x91ab47c6e3f10ee3f8d0c0c3a2c8e2d2c5a4b100', mark: 'wave' },
    { handle: 'fossil.kim.eth', role: 'Archival', addr: '0x4f2a7b18c3d2c1a0b9e8f7d6c5b4a39281706f5e', mark: 'fossil' },
    { handle: 'silt.eth', role: 'LP / yield', addr: '0x73a8c1b27d4e5f6a8b9c0d1e2f3a4b5c6d7e8f90', mark: 'grain' },
    { handle: 'basalt.eth', role: 'Core dev', addr: '0x18f3a2b4c5d6e7f8091a2b3c4d5e6f70819203a4', mark: 'block' },
    { handle: 'ash.eth', role: 'Community mod', addr: '0x5b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8', mark: 'spark' },
    { handle: 'magma.eth', role: 'Events / gigs', addr: '0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4', mark: 'flame' },
  ];

  const SKIN_LABELS = { tremor: 'Tremor', obsidian: 'Obsidian', fossil: 'Fossil' };

  // 8 simple procedural avatar glyphs (mark-based), reused across the app
  const MARKS = {
    rock:   (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><polygon points="48,14 78,30 78,66 48,82 18,66 18,30" fill="${color}" opacity="0.9"/><polygon points="48,30 62,38 62,58 48,66 34,58 34,38" fill="${color}" opacity="0.4"/><circle cx="48" cy="48" r="6" fill="${color}"/></svg>`,
    wave:   (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path d="M8 48 Q24 28 40 48 T72 48 T88 48" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M8 60 Q24 40 40 60 T72 60 T88 60" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.6"/><path d="M8 36 Q24 16 40 36 T72 36 T88 36" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.3"/></svg>`,
    fossil: (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><circle cx="48" cy="48" r="32" fill="none" stroke="${color}" stroke-width="2.5"/><circle cx="48" cy="48" r="22" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/><circle cx="48" cy="48" r="12" fill="none" stroke="${color}" stroke-width="2" opacity="0.4"/><circle cx="48" cy="48" r="3" fill="${color}"/></svg>`,
    grain:  (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="4" fill="${color}"/><circle cx="50" cy="30" r="4" fill="${color}" opacity="0.7"/><circle cx="70" cy="30" r="4" fill="${color}" opacity="0.5"/><circle cx="30" cy="50" r="4" fill="${color}" opacity="0.7"/><circle cx="50" cy="50" r="4" fill="${color}"/><circle cx="70" cy="50" r="4" fill="${color}" opacity="0.6"/><circle cx="30" cy="70" r="4" fill="${color}" opacity="0.5"/><circle cx="50" cy="70" r="4" fill="${color}" opacity="0.7"/><circle cx="70" cy="70" r="4" fill="${color}"/></svg>`,
    block:  (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="18" width="60" height="60" fill="none" stroke="${color}" stroke-width="2.5"/><rect x="28" y="28" width="40" height="40" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/><rect x="38" y="38" width="20" height="20" fill="${color}" opacity="0.5"/></svg>`,
    spark:  (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path d="M48 16 L52 44 L80 48 L52 52 L48 80 L44 52 L16 48 L44 44 Z" fill="${color}"/></svg>`,
    flame:  (color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path d="M48 14 C58 30 70 38 70 54 C70 70 60 80 48 80 C36 80 26 70 26 54 C26 42 36 36 42 30 C44 36 48 38 48 30 Z" fill="${color}"/><path d="M48 36 C52 44 58 50 58 58 C58 66 54 70 48 70 C42 70 38 66 38 58 C38 50 44 46 48 36 Z" fill="${color}" opacity="0.5"/></svg>`,
    default:(color) => `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><circle cx="48" cy="48" r="28" fill="none" stroke="${color}" stroke-width="2.5"/><circle cx="48" cy="48" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/><circle cx="48" cy="48" r="4" fill="${color}"/></svg>`,
  };

  // ---------------- state ----------------
  const state = {
    wallet: null,
    skin: 'tremor',
    handle: '',
    signatureSvg: '',
    rarityCounter: 100,
    minted: [],
    membersBentoBuilt: false,
  };

  // load minted from localStorage
  try {
    const stored = JSON.parse(localStorage.getItem('seismic.sig.minted') || '[]');
    if (Array.isArray(stored)) state.minted = stored;
    const counter = parseInt(localStorage.getItem('seismic.sig.counter') || '100', 10);
    if (!isNaN(counter)) state.rarityCounter = counter;
  } catch (_) { /* fresh state */ }

  // ---------------- utilities ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const shortAddr = (a) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '0x0000...0000';
  const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const todayStamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  };
  const pad4 = (n) => String(n).padStart(4, '0');

  const detectMark = (handle) => {
    const m = (FOUNDING_MEMBERS.find(x => x.handle === handle) || {}).mark;
    return m || 'default';
  };

  const colorForSkin = (skin) => {
    if (skin === 'obsidian') return '#d97a3c';
    if (skin === 'fossil')   return '#3d2e1a';
    return '#f5b56b';
  };

  // simple hash -> 6 hex for rarity id color hint (not used in DOM, kept for future)
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
  };

  // ---------------- marquee ----------------
  function buildMarquee() {
    const track = $('#memberMarquee');
    if (!track) return;
    // duplicate items so the scroll loops seamlessly
    const item = (m) => `<span class="marquee-item"><span class="dot-mark"></span>${m.handle}<span class="role">/ ${m.role}</span></span>`;
    const html = FOUNDING_MEMBERS.map(item).join('');
    track.innerHTML = html + html; // double for seamless loop
  }

  // ---------------- members bento ----------------
  function buildMembersBento() {
    const root = $('#membersBento');
    if (!root) return;
    // asymmetric layout assignment
    const sizeMap = ['size-wide', 'size-tall', 'size-norm', 'size-sq', 'size-slim', 'size-norm', 'size-tall'];
    const html = FOUNDING_MEMBERS.map((m, i) => {
      const num = pad4(i + 1);
      const color = colorForSkin(['tremor', 'obsidian', 'fossil'][i % 3]);
      return `
        <div class="mb ${sizeMap[i]}">
          <span class="mb-num">${num}</span>
          <div class="mb-handle">${m.handle}</div>
          <div class="mb-role">${m.role}</div>
          <div class="mb-addr">${shortAddr(m.addr)}</div>
          <div class="mb-mark">${MARKS[m.mark](color)}</div>
        </div>
      `;
    }).join('');
    root.innerHTML = html;
    state.membersBentoBuilt = true;
  }

  // ---------------- preview card ----------------
  function renderCardPreview() {
    const handleEl = $('#cardHandle');
    const addrEl = $('#cardAddr');
    const sigEl = $('#cardSigWrap');
    const footEl = $('#cardFootId');
    const avatarEl = $('#cardAvatar');
    const issuedEl = $('#cardIssued');
    const cardEl = $('#cardPreview');

    if (!handleEl || !cardEl) return;

    const handle = state.handle || 'handle';
    handleEl.textContent = '@' + handle.replace(/^@/, '');
    addrEl.textContent = state.wallet ? shortAddr(state.wallet) : '0x0000...0000';
    issuedEl.textContent = todayStamp();
    footEl.textContent = `SIG-00-${pad4(state.rarityCounter)}`;

    if (state.signatureSvg) {
      sigEl.innerHTML = state.signatureSvg;
    } else {
      sigEl.innerHTML = '<span class="card-sig-empty">no signature yet</span>';
    }

    const mark = detectMark(handle);
    const color = colorForSkin(state.skin);
    avatarEl.innerHTML = MARKS[mark](color);

    // swap theme class
    cardEl.className = 'identity-card theme-' + state.skin;
  }

  // ---------------- signature canvas ----------------
  function setupSignatureCanvas() {
    const canvas = $('#signatureCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let drawing = false, lastX = 0, lastY = 0;
    let hasInk = false;
    let debounceTimer = null;

    const resize = () => {
      // re-render on resize
      const data = canvas.toDataURL();
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 720;
      const h = canvas.clientHeight || 220;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      if (data && hasInk) img.src = data;
    };

    const start = (e) => {
      e.preventDefault();
      drawing = true;
      const { x, y } = point(e);
      lastX = x; lastY = y;
      hasInk = true;
    };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const { x, y } = point(e);
      ctx.strokeStyle = '#3d2e1a';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x; lastY = y;
    };
    const end = () => {
      if (!drawing) return;
      drawing = false;
      // generate svg from canvas
      const data = canvas.toDataURL('image/png');
      state.signatureSvg = `<img alt="signature" src="${data}" style="max-height:60px;filter:invert(1) brightness(1.6);">`;
      renderCardPreview();
    };

    const point = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    $('#clearSigBtn')?.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      state.signatureSvg = '';
      hasInk = false;
      renderCardPreview();
    });

    window.addEventListener('resize', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(resize, 120);
    });
    resize();
  }

  // ---------------- handle input ----------------
  function setupHandleInput() {
    const input = $('#handleInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
      const v = e.target.value.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
      e.target.value = v;
      state.handle = v;
      renderCardPreview();
    });

    $('#loadAvatarBtn')?.addEventListener('click', () => {
      const status = $('#statusText');
      status.textContent = 'X search is not wired in this build. Type a handle or ENS manually.';
    });
  }

  // ---------------- skin switcher ----------------
  function setupSkinSwitcher() {
    const dots = $$('.skin-dot');
    const label = $('#skinLabel');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const theme = dot.dataset.theme;
        state.skin = theme;
        dots.forEach(d => {
          const active = d === dot;
          d.classList.toggle('is-active', active);
          d.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (label) label.textContent = SKIN_LABELS[theme];
        renderCardPreview();
      });
    });
  }

  // ---------------- wallet (mock) ----------------
  function setupWallet() {
    const btn = $('#connectBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (state.wallet) {
        // disconnect
        state.wallet = null;
        btn.textContent = 'Connect wallet';
        btn.classList.remove('is-connected');
        $('#statusText').textContent = 'wallet disconnected. connect again to mint.';
      } else {
        // mock connect: random address
        const mock = '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        state.wallet = mock;
        btn.textContent = shortAddr(mock);
        btn.classList.add('is-connected');
        $('#statusText').textContent = 'wallet connected (mock). ready to sign and submit.';
        appendTerminalLine(`[ok] wallet bound: ${shortAddr(mock)}`);
      }
      renderCardPreview();
    });
  }

  // ---------------- mint flow ----------------
  function setupMint() {
    const btn = $('#mintBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!state.wallet) {
        $('#statusText').textContent = 'connect a wallet first. the signature is bound to the address.';
        return;
      }
      if (!state.handle) {
        $('#statusText').textContent = 'enter a handle or ENS first.';
        $('#handleInput').focus();
        return;
      }

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'signing...';

      // simulate tx latency
      setTimeout(() => {
        const entry = {
          handle: state.handle,
          addr: state.wallet,
          skin: state.skin,
          signatureSvg: state.signatureSvg,
          rarity: pad4(state.rarityCounter),
          issued: todayStamp(),
          ts: Date.now(),
        };
        state.minted.unshift(entry);
        state.rarityCounter += 1;

        // persist
        try {
          localStorage.setItem('seismic.sig.minted', JSON.stringify(state.minted));
          localStorage.setItem('seismic.sig.counter', String(state.rarityCounter));
        } catch (_) { /* quota */ }

        $('#mintedCount').textContent = pad4(state.minted.length);
        appendTerminalLine(`[ok] stamped SIG-00-${entry.rarity} for @${entry.handle}`);
        appendTerminalLine(`[ok] tx hash: 0x${hash(entry.handle + entry.rarity)}...`);

        renderMinted();
        btn.disabled = false;
        btn.textContent = originalText;
        $('#statusText').textContent = `minted SIG-00-${entry.rarity}. ${SKIN_LABELS[state.skin]} skin, on ${shortAddr(state.wallet)}.`;

        // smooth scroll to collection
        document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 900);
    });
  }

  // ---------------- mint collection + pagination ----------------
  const PAGE_SIZE = 6;
  let currentPage = 1;

  function renderMinted() {
    const grid = $('#mintedGrid');
    const pagination = $('#mintedPagination');
    if (!grid || !pagination) return;

    const items = state.minted;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    if (slice.length === 0) {
      grid.innerHTML = `
        <div class="collection-empty">
          <strong>no signatures yet</strong>
          forge your first card to seed the collection. submissions live in this browser only.
        </div>
      `;
      pagination.innerHTML = '';
      return;
    }

    grid.innerHTML = slice.map((m, i) => {
      const idx = start + i;
      const color = colorForSkin(m.skin);
      const avatar = MARKS[detectMark(m.handle)](color);
      const sigRender = m.signatureSvg
        ? `<div class="minted-sig">${m.signatureSvg}</div>`
        : `<div class="minted-sig"><span class="empty">no signature</span></div>`;
      return `
        <article class="minted-card" aria-label="minted card ${idx + 1}">
          <div class="minted-card-head">
            <span class="minted-handle">@${m.handle}</span>
            <span class="minted-rarity">#${m.rarity}</span>
          </div>
          <div class="minted-addr">${shortAddr(m.addr)}</div>
          <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;">${avatar}</div>
          ${sigRender}
          <div class="minted-meta">
            <span>${SKIN_LABELS[m.skin]}</span>
            <span>${m.issued}</span>
          </div>
        </article>
      `;
    }).join('');

    // pagination
    let pagHtml = '';
    pagHtml += `<button data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>prev</button>`;
    for (let p = 1; p <= totalPages; p++) {
      pagHtml += `<button data-page="${p}" class="${p === currentPage ? 'is-active' : ''}">${p}</button>`;
    }
    pagHtml += `<button data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>next</button>`;
    pagination.innerHTML = pagHtml;

    pagination.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset.page;
        if (v === 'prev') currentPage = Math.max(1, currentPage - 1);
        else if (v === 'next') currentPage = Math.min(totalPages, currentPage + 1);
        else currentPage = parseInt(v, 10);
        renderMinted();
      });
    });
  }

  // ---------------- terminal ----------------
  function appendTerminalLine(text) {
    const body = $('#terminalBody');
    if (!body) return;
    const li = document.createElement('li');
    li.innerHTML = text;
    body.appendChild(li);
    while (body.children.length > 6) body.removeChild(body.firstChild);
  }

  function tickTerminal() {
    const stamp = $('#forgeStamp');
    if (stamp) stamp.textContent = nowStamp().slice(11);
    const footer = $('#footerTime');
    if (footer) footer.textContent = nowStamp().slice(11) + ' utc';
    // simulate a quiet block height drift
    const blockEl = $('#blockHeight');
    if (blockEl) {
      const cur = parseInt(blockEl.textContent.replace(/[^0-9]/g, ''), 10);
      const next = (isNaN(cur) ? 1240000 : cur + 1) % 9999999;
      blockEl.textContent = '#' + pad4(next);
    }
    const queued = $('#queuedStamps');
    if (queued) queued.textContent = state.minted.length;
  }

  // ---------------- boot ----------------
  function boot() {
    buildMarquee();
    buildMembersBento();
    setupSignatureCanvas();
    setupHandleInput();
    setupSkinSwitcher();
    setupWallet();
    setupMint();
    renderCardPreview();
    renderMinted();
    $('#mintedCount').textContent = pad4(state.minted.length);
    tickTerminal();
    setInterval(tickTerminal, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
