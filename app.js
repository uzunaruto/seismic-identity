/* ============================================================
   Seismic ID v3 — Frontend logic
   - State: localStorage (key: seismicIdProfile.v3)
   - OAuth: Discord via Vercel serverless callback
   - Card: live preview, 162 variants, magnitude color-coded
   - Export: PNG (html2canvas), PDF (jsPDF), X share (intent)
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  STORAGE_KEY: 'seismicIdProfile.v3',
  VERIFY_BASE: 'https://seismic-identity.vercel.app/verify/',
  SEISMIC_GUILD_ID: '1343751435711414362',

  SHARE_TEXT: (name, handle, role) => {
    const r = role ? ` · ${role}` : '';
    return `Just minted my Seismic Community ID. ${name}${handle ? ` (@${handle})` : ''}${r} · Discord-verified, no wallet needed. #SeismicID`;
  },
};

// ============================================================
// STATE
// ============================================================
const defaultState = {
  identity: null,    // { source: 'discord' | 'manual', id, name, handle, pfp, role, magnitude, tier }
  signature: null,   // dataURL
  seismicId: null,
  issued: null,
  ratio: 'portrait', // portrait | landscape | square
  theme: 'obsidian', // obsidian | copper | fossil
  finish: 'matte',   // matte | holographic
  avatar: 'circle',  // circle | squircle | hex
  border: 'minimal', // minimal | glow | stamp
  customTitle: '',   // overrides role label
};

let state = loadState();
let qrInstance = null;

// ============================================================
// STORAGE
// ============================================================
function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed };
  } catch (e) {
    console.warn('Failed to load state:', e);
    return { ...defaultState };
  }
}
function saveState() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}
function clearAllState() {
  localStorage.removeItem(CONFIG.STORAGE_KEY);
  state = { ...defaultState };
}

// ============================================================
// SEISMIC ID
// ============================================================
function generateSeismicId() {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `SEI-${hex()}-${hex()}-${hex()}`;
}

// ============================================================
// MAGNITUDE DETECTION
// ============================================================
function detectMagnitude(role) {
  if (!role) return null;
  const m = role.match(/^Magnitude\s+(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 9) return n;
  }
  return null;
}

function detectRoleKind(role) {
  if (!role) return 'member';
  if (detectMagnitude(role) !== null) return 'magnified';
  if (/core\s*team/i.test(role)) return 'core';
  if (/^og$/i.test(role)) return 'og';
  if (/contributor/i.test(role)) return 'contributor';
  return 'member';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// VIEW ROUTING
// ============================================================
function showView(name) {
  const connect = document.getElementById('view-connect');
  const builder = document.getElementById('view-builder');
  const resetBtn = document.getElementById('resetBtn');
  if (name === 'builder') {
    connect.hidden = true;
    builder.hidden = false;
    resetBtn.hidden = false;
    renderBuilder();
  } else {
    connect.hidden = false;
    builder.hidden = true;
    resetBtn.hidden = true;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function determineInitialView() {
  const hash = window.location.hash;
  if (hash.startsWith('#discord=')) {
    handleDiscordCallback();
  }
  if (state.identity) {
    showView('builder');
  } else {
    showView('connect');
  }
}

function handleDiscordCallback() {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  try {
    const encoded = params.get('discord');
    const data = JSON.parse(atob(decodeURIComponent(encoded)));
    state.identity = {
      source: 'discord',
      id: data.id,
      name: data.global_name || data.username,
      handle: '', // not collected from Discord
      pfp: data.avatar,
      role: data.role || null,
      magnitude: detectMagnitude(data.role),
      tier: data.tier || 'unknown',
      inGuild: !!data.inSeismicGuild,
    };
    if (!state.seismicId) {
      state.seismicId = generateSeismicId();
      state.issued = new Date().toISOString();
    }
    saveState();
    history.replaceState(null, '', window.location.pathname);
    toast(`Discord connected · ${data.role || 'member'}`, 'ok');
  } catch (e) {
    console.error('Discord callback parse failed:', e);
    toast('Connection failed. Try again.', 'err');
  }
}

// ============================================================
// CONNECT VIEW
// ============================================================
function initConnectView() {
  const form = document.getElementById('manualForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('mName').value.trim();
    const pfp = document.getElementById('mPfp').value.trim();
    const handle = document.getElementById('mHandle').value.trim().replace(/^@/, '');
    const role = document.getElementById('mRole').value.trim();

    if (!name) {
      toast('Display name is required', 'err');
      return;
    }
    if (handle && !/^[A-Za-z0-9_]{1,32}$/.test(handle)) {
      toast('Invalid X handle format', 'err');
      return;
    }
    if (pfp && !/^https?:\/\//i.test(pfp)) {
      toast('PFP URL must start with http(s)://', 'err');
      return;
    }

    state.identity = {
      source: 'manual',
      id: null,
      name,
      handle,
      pfp: pfp || null,
      role: role || null,
      magnitude: detectMagnitude(role),
      tier: 'self',
      inGuild: false,
    };
    if (!state.seismicId) {
      state.seismicId = generateSeismicId();
      state.issued = new Date().toISOString();
    }
    saveState();
    showView('builder');
  });
}

// ============================================================
// BUILDER VIEW
// ============================================================
function renderBuilder() {
  renderIdentityCard();
  renderSegGroups();
  renderCustomTitle();
  renderCard();
  renderExport();
  initSignaturePad();
}

function renderIdentityCard() {
  const id = state.identity;
  const pfp = document.getElementById('idPfp');
  const name = document.getElementById('idName');
  const handle = document.getElementById('idHandle');
  const roleEl = document.getElementById('idRole');
  const roleText = document.getElementById('idRoleText');

  if (!id) {
    name.textContent = '— no identity —';
    handle.textContent = 'Connect Discord or fill the manual form';
    pfp.style.backgroundImage = '';
    roleEl.hidden = true;
    return;
  }
  name.textContent = id.name || '—';
  handle.textContent = id.handle ? `@${id.handle}` : (id.source === 'discord' ? `discord · ${id.id?.slice(-4) || '?'}` : 'self-submitted');
  pfp.style.backgroundImage = id.pfp ? `url('${id.pfp}')` : '';
  if (id.role) {
    roleEl.hidden = false;
    roleText.textContent = id.role;
    roleEl.dataset.roleKind = detectRoleKind(id.role);
    roleEl.dataset.magnitude = id.magnitude || '';
  } else {
    roleEl.hidden = true;
  }
}

function renderSegGroups() {
  // ratioSeg
  const ratioSeg = document.getElementById('ratioSeg');
  if (ratioSeg) {
    ratioSeg.querySelectorAll('.seg__opt').forEach(btn => {
      const active = btn.dataset.ratio === state.ratio;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active);
      btn.onclick = () => {
        state.ratio = btn.dataset.ratio;
        saveState();
        renderSegGroups();
        renderCard();
      };
    });
  }
  // themeSeg
  const themeSeg = document.getElementById('themeSeg');
  if (themeSeg) {
    themeSeg.querySelectorAll('.seg__opt').forEach(btn => {
      const active = btn.dataset.theme === state.theme;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active);
      btn.onclick = () => {
        state.theme = btn.dataset.theme;
        saveState();
        renderSegGroups();
        renderCard();
      };
    });
  }
  // finishSeg
  const finishSeg = document.getElementById('finishSeg');
  if (finishSeg) {
    finishSeg.querySelectorAll('.seg__opt').forEach(btn => {
      const active = btn.dataset.finish === state.finish;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active);
      btn.onclick = () => {
        state.finish = btn.dataset.finish;
        saveState();
        renderSegGroups();
        renderCard();
      };
    });
  }
  // avatarSeg
  const avatarSeg = document.getElementById('avatarSeg');
  if (avatarSeg) {
    avatarSeg.querySelectorAll('.seg__opt').forEach(btn => {
      const active = btn.dataset.avatar === state.avatar;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active);
      btn.onclick = () => {
        state.avatar = btn.dataset.avatar;
        saveState();
        renderSegGroups();
        renderCard();
      };
    });
  }
  // borderSeg
  const borderSeg = document.getElementById('borderSeg');
  if (borderSeg) {
    borderSeg.querySelectorAll('.seg__opt').forEach(btn => {
      const active = btn.dataset.border === state.border;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active);
      btn.onclick = () => {
        state.border = btn.dataset.border;
        saveState();
        renderSegGroups();
        renderCard();
      };
    });
  }
}

function renderCustomTitle() {
  const input = document.getElementById('customTitle');
  if (!input) return;
  input.value = state.customTitle || '';
  input.oninput = () => {
    state.customTitle = input.value;
    saveState();
    renderCard();
  };
}

// ============================================================
// SIGNATURE PAD
// ============================================================
let sigHasInk = false;
function initSignaturePad() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const clearBtn = document.getElementById('sigClear');
  const hint = document.getElementById('sigHint');

  function setup() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a0e02';
  }
  setup();

  // restore previous signature
  if (state.signature) {
    const img = new Image();
    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      sigHasInk = true;
      hint.textContent = 'saved';
    };
    img.src = state.signature;
  }

  let drawing = false, lx = 0, ly = 0;
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function start(e) {
    e.preventDefault();
    drawing = true;
    const p = pos(e);
    lx = p.x; ly = p.y;
    sigHasInk = true;
    hint.textContent = 'signing…';
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lx = p.x; ly = p.y;
  }
  function end() {
    if (!drawing) return;
    drawing = false;
    if (sigHasInk) {
      state.signature = canvas.toDataURL('image/png');
      saveState();
      hint.textContent = 'saved';
      renderCardSig();
    }
  }

  canvas.onmousedown = start;
  canvas.onmousemove = move;
  window.addEventListener('mouseup', end);
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = end;

  clearBtn.onclick = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.signature = null;
    sigHasInk = false;
    hint.textContent = 'Sign above';
    saveState();
    renderCardSig();
  };
}

function renderCardSig() {
  const box = document.getElementById('cardSigBox');
  if (!box) return;
  box.innerHTML = '';
  if (state.signature) {
    const img = document.createElement('img');
    img.src = state.signature;
    img.alt = 'Signature';
    box.appendChild(img);
  } else {
    const i = document.createElement('i');
    i.className = 'ph ph-pen-nib card__sig-placeholder';
    box.appendChild(i);
  }
}

// ============================================================
// CARD RENDER
// ============================================================
function renderCard() {
  const card = document.getElementById('card');
  if (!card) return;

  // data attributes
  card.dataset.theme = state.theme;
  card.dataset.ratio = state.ratio;
  card.dataset.finish = state.finish;
  card.dataset.avatar = state.avatar;
  card.dataset.border = state.border;

  // identity
  const id = state.identity;
  const pfp = document.getElementById('cardPfp');
  const name = document.getElementById('cardName');
  const handle = document.getElementById('cardHandle');
  const role = document.getElementById('cardRole');
  const roleText = document.getElementById('cardRoleText');
  const seismicId = document.getElementById('cardSeismicId');
  const issued = document.getElementById('cardIssued');

  if (id) {
    name.textContent = id.name || '—';
    handle.textContent = id.handle ? `@${id.handle}` : (id.source === 'discord' ? '@discord' : '@self');
    handle.href = id.handle ? `https://x.com/${id.handle}` : '#';
    if (id.pfp) {
      pfp.style.backgroundImage = `url('${id.pfp}')`;
      pfp.innerHTML = '';
    } else {
      pfp.style.backgroundImage = '';
      pfp.innerHTML = '<i class="ph ph-user"></i>';
    }
  } else {
    name.textContent = 'Display name';
    handle.textContent = '@handle';
    handle.href = '#';
    pfp.style.backgroundImage = '';
    pfp.innerHTML = '<i class="ph ph-user"></i>';
  }

  // role badge
  const displayLabel = state.customTitle || (id && id.role) || 'Seismic Member';
  const mag = state.customTitle ? null : (id && id.magnitude);
  roleText.textContent = displayLabel;
  role.dataset.magnitude = mag || '';
  role.dataset.roleKind = detectRoleKind(state.customTitle ? null : (id && id.role));
  if (mag || id?.role || state.customTitle) {
    role.hidden = false;
  } else {
    role.hidden = true;
  }

  // meta
  seismicId.textContent = state.seismicId || 'SEI-0000-0000-0000';
  if (state.issued) {
    const d = new Date(state.issued);
    issued.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  // copy label
  const copyLabel = document.getElementById('copyIdLabel');
  if (copyLabel) {
    copyLabel.textContent = state.seismicId ? state.seismicId.slice(0, 8) + '…' : 'SEI-…';
  }

  // signature
  renderCardSig();

  // QR
  renderQR();
}

function renderQR() {
  const container = document.getElementById('cardQr');
  if (!container) return;
  container.innerHTML = '';
  if (qrInstance) {
    try { qrInstance.clear(); } catch {}
  }
  if (!window.QRCode) return;
  const url = state.seismicId ? CONFIG.VERIFY_BASE + state.seismicId : CONFIG.VERIFY_BASE;
  try {
    qrInstance = new QRCode(container, {
      text: url,
      width: 56,
      height: 56,
      colorDark: '#0a0907',
      colorLight: '#f4ede4',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    console.warn('QR render failed:', e);
  }
}

// ============================================================
// EXPORT
// ============================================================
function renderExport() {
  const exportPng = document.getElementById('exportPng');
  const exportPdf = document.getElementById('exportPdf');
  const shareX = document.getElementById('shareX');
  const copyId = document.getElementById('copyIdBtn');
  const regenId = document.getElementById('regenId');

  if (exportPng) exportPng.onclick = () => exportCardImage('png');
  if (exportPdf) exportPdf.onclick = () => exportCardImage('pdf');
  if (shareX) shareX.onclick = shareToX;
  if (copyId) copyId.onclick = copySeismicId;
  if (regenId) regenId.onclick = regenerateSeismicId;
}

async function exportCardImage(format) {
  const card = document.getElementById('card');
  if (!card || !window.html2canvas) {
    toast('Image library not loaded', 'err');
    return;
  }
  toast('Rendering card…', 'info');
  try {
    const canvas = await html2canvas(card, {
      backgroundColor: null,
      scale: 3,
      useCORS: true,
      allowTaint: true,
    });
    if (format === 'png') {
      const link = document.createElement('a');
      link.download = `${state.seismicId || 'seismic-id'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('PNG downloaded', 'ok');
    } else if (format === 'pdf') {
      if (!window.jspdf) { toast('PDF library not loaded', 'err'); return; }
      const { jsPDF } = window.jspdf;
      const orientation = state.ratio === 'landscape' ? 'l' : 'p';
      const pdf = new jsPDF({
        orientation,
        unit: 'px',
        format: [canvas.width, canvas.height],
        hotfixes: ['px_scaling'],
      });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${state.seismicId || 'seismic-id'}.pdf`);
      toast('PDF downloaded', 'ok');
    }
  } catch (e) {
    console.error('Export failed:', e);
    toast('Export failed', 'err');
  }
}

function shareToX() {
  if (!state.identity) {
    toast('Build your card first', 'err');
    return;
  }
  const text = CONFIG.SHARE_TEXT(state.identity.name, state.identity.handle, state.customTitle || state.identity.role);
  const url = state.seismicId ? CONFIG.VERIFY_BASE + state.seismicId : '';
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intent, '_blank', 'noopener');
}

async function copySeismicId() {
  if (!state.seismicId) return;
  try {
    await navigator.clipboard.writeText(state.seismicId);
    toast('Seismic ID copied', 'ok');
  } catch {
    toast('Copy failed', 'err');
  }
}

function regenerateSeismicId() {
  state.seismicId = generateSeismicId();
  state.issued = new Date().toISOString();
  saveState();
  renderCard();
  toast('New Seismic ID minted', 'ok');
}

// ============================================================
// EDIT IDENTITY
// ============================================================
function initEditIdentity() {
  const btn = document.getElementById('editIdentityBtn');
  if (!btn) return;
  btn.onclick = () => {
    if (confirm('Clear identity and return to connect screen?')) {
      state.identity = null;
      saveState();
      showView('connect');
    }
  };
}

// ============================================================
// RESET
// ============================================================
function initReset() {
  const btn = document.getElementById('resetBtn');
  if (!btn) return;
  btn.onclick = () => {
    if (confirm('Clear all card data and start over?')) {
      clearAllState();
      showView('connect');
      toast('Reset complete', 'ok');
    }
  };
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  const icon = kind === 'ok' ? 'check-circle' : kind === 'err' ? 'warning-circle' : 'info';
  el.innerHTML = `<i class="ph-fill ph-${icon}"></i><span>${escapeHtml(msg)}</span>`;
  el.className = 'toast toast--' + (kind || 'info');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2500);
}

// ============================================================
// BOOT
// ============================================================
function boot() {
  initConnectView();
  initEditIdentity();
  initReset();
  determineInitialView();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
