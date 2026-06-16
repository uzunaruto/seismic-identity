/* ============================================================
   Seismic ID v2 — Frontend logic
   - State: localStorage (key: seismicIdProfile)
   - OAuth: Discord + X via Vercel serverless callbacks
   - Card: live preview, theme/finish, signature
   - Export: PNG (html2canvas), PDF (jsPDF), X share (intent)
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  // Discord guild to verify membership against
  SEISMIC_GUILD_ID: '1343751435711414362',

  // Known Discord ID -> role mapping (edit to add verified members)
  // Roles are case-insensitive strings shown on the badge.
  KNOWN_ROLES: {
    // '123456789012345678': 'Founder',
    // Archanist: add your Discord ID here once you fetch it from a successful OAuth
  },

  // Verification URL encoded into QR
  VERIFY_BASE: 'https://seismic-identity.vercel.app/verify/',

  // Storage key
  STORAGE_KEY: 'seismicIdProfile.v2',

  // Share text template
  SHARE_TEXT: (name, handle, role) => {
    const r = role && role !== 'Seismic Member' ? ` · ${role}` : '';
    return `Just minted my Seismic Community ID. ${name} (@${handle})${r} · verified by Discord · built on @SeismicSys. #SeismicID`;
  },
};

// ============================================================
// STATE
// ============================================================
const defaultState = {
  x: null,        // { source: 'oauth' | 'manual', name, handle, pfp }
  discord: null,  // { id, username, inSeismicGuild, role }
  signature: null,// dataURL
  seismicId: null,
  theme: 'obsidian',
  finish: 'matte',
  issued: null,   // ISO date
};

let state = loadState();
let qrInstance = null; // QRCode instance

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

function clearState() {
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
  // After OAuth callback, data is in hash
  const hash = window.location.hash;
  if (hash.startsWith('#discord=') || hash.startsWith('#x=')) {
    handleOAuthCallback();
  }

  // If we have either x or discord data, go to builder
  if (state.x || state.discord) {
    showView('builder');
  } else {
    showView('connect');
  }
}

// ============================================================
// OAUTH CALLBACK HANDLING
// ============================================================
function handleOAuthCallback() {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const provider = params.has('discord') ? 'discord' : params.has('x') ? 'x' : null;
  if (!provider) return;

  try {
    const encoded = params.get(provider);
    const data = JSON.parse(atob(decodeURIComponent(encoded)));

    if (provider === 'discord') {
      state.discord = {
        id: data.id,
        username: data.username,
        global_name: data.global_name,
        inSeismicGuild: !!data.inSeismicGuild,
        role: data.role || 'Seismic Member',
      };
      toast('Discord connected', 'ok');
    } else if (provider === 'x') {
      state.x = {
        source: 'oauth',
        name: data.name,
        handle: data.username,
        pfp: data.profile_image_url,
      };
      toast('X connected', 'ok');
    }

    if (!state.seismicId) {
      state.seismicId = generateSeismicId();
      state.issued = new Date().toISOString();
    }

    saveState();
    // Clean URL
    history.replaceState(null, '', window.location.pathname);
  } catch (e) {
    console.error('OAuth callback parse failed:', e);
    toast('Connection failed. Try again.', 'err');
  }
}

// ============================================================
// CONNECT VIEW
// ============================================================
function initConnectView() {
  // Manual form
  const form = document.getElementById('manualForm');
  const pfpPreview = document.getElementById('mPfpPreview');
  const pfpUrlInput = document.getElementById('mPfpUrl');
  const pfpFileInput = document.getElementById('mPfpFile');
  const pfpUploadBtn = document.getElementById('mPfpUpload');

  let manualPfp = null;

  pfpUploadBtn.addEventListener('click', () => pfpFileInput.click());

  pfpFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Image too large (max 2MB)', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      manualPfp = ev.target.result;
      pfpPreview.style.backgroundImage = `url(${manualPfp})`;
      pfpUrlInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  pfpUrlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
      manualPfp = url;
      pfpPreview.style.backgroundImage = `url(${url})`;
    } else {
      manualPfp = null;
      pfpPreview.style.backgroundImage = '';
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('mName').value.trim();
    const handle = document.getElementById('mHandle').value.trim().replace(/^@/, '');

    if (!name || !handle) {
      toast('Name and handle are required', 'err');
      return;
    }
    if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) {
      toast('Invalid X handle format', 'err');
      return;
    }

    state.x = {
      source: 'manual',
      name,
      handle,
      pfp: manualPfp || null,
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
  renderXStatus();
  renderDiscordStatus();
  renderSignature();
  renderCardOptions();
  renderCard();
  renderExport();
}

function renderXStatus() {
  const el = document.getElementById('xStatus');
  const editBtn = document.getElementById('xEditBtn');
  const reconnectBtn = document.getElementById('xReconnectBtn');

  if (!state.x) {
    el.className = 'status status--warn';
    el.innerHTML = `
      <i class="ph ph-warning" aria-hidden="true"></i>
      <div class="status__body">
        <div class="status__line1">Not connected</div>
        <div class="status__line2">Connect X or fill manually to add identity.</div>
      </div>
    `;
    editBtn.hidden = true;
    reconnectBtn.hidden = false;
    reconnectBtn.onclick = () => window.location.href = '/api/x/auth';
    return;
  }

  const isOauth = state.x.source === 'oauth';
  el.className = 'status status--ok';
  el.innerHTML = `
    <div class="status__pfp" style="${state.x.pfp ? `background-image:url('${state.x.pfp}')` : ''}"></div>
    <div class="status__body">
      <div class="status__line1"><strong>${escapeHtml(state.x.name)}</strong> <span>· @${escapeHtml(state.x.handle)}</span></div>
      <div class="status__line2">${isOauth ? 'Verified via X OAuth' : 'Self-Submitted Profile'}</div>
    </div>
  `;
  editBtn.hidden = isOauth; // manual profiles can be edited
  editBtn.onclick = () => {
    if (confirm('Clear X profile and return to manual entry?')) {
      state.x = null;
      saveState();
      showView('connect');
    }
  };
  reconnectBtn.hidden = false;
  reconnectBtn.onclick = () => window.location.href = '/api/x/auth';
}

function renderDiscordStatus() {
  const el = document.getElementById('discordStatus');
  const reconnectBtn = document.getElementById('discordReconnectBtn');

  if (!state.discord) {
    el.className = 'status status--warn';
    el.innerHTML = `
      <i class="ph ph-warning" aria-hidden="true"></i>
      <div class="status__body">
        <div class="status__line1">Not verified</div>
        <div class="status__line2">Connect Discord to verify community membership and detect role.</div>
      </div>
    `;
    reconnectBtn.hidden = false;
    reconnectBtn.onclick = () => window.location.href = '/api/discord/auth';
    return;
  }

  const verified = state.discord.inSeismicGuild;
  el.className = `status ${verified ? 'status--ok' : 'status--warn'}`;
  el.innerHTML = `
    <i class="ph-fill ph-${verified ? 'seal-check' : 'warning'}" aria-hidden="true"></i>
    <div class="status__body">
      <div class="status__line1"><strong>${verified ? 'Seismic member' : 'Not in Seismic guild'}</strong>${state.discord.role && state.discord.role !== 'Seismic Member' ? ` <span>· ${escapeHtml(state.discord.role)}</span>` : ''}</div>
      <div class="status__line2">${verified ? 'Role badge attached to your card.' : 'Join the Seismic Discord to get a role badge.'}</div>
    </div>
  `;
  reconnectBtn.hidden = false;
  reconnectBtn.onclick = () => window.location.href = '/api/discord/auth';
}

// ============================================================
// SIGNATURE CANVAS
// ============================================================
function initSignaturePad() {
  const canvas = document.getElementById('sigCanvas');
  const ctx = canvas.getContext('2d');
  const clearBtn = document.getElementById('sigClear');
  const hint = document.getElementById('sigHint');

  // Set up high-DPI canvas
  function setupCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a0e02';
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let hasInk = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    isDrawing = true;
    const p = getPos(e);
    lastX = p.x; lastY = p.y;
    hasInk = true;
    hint.textContent = 'signing…';
  }

  function move(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }

  function end() {
    if (!isDrawing) return;
    isDrawing = false;
    if (hasInk) {
      state.signature = canvas.toDataURL('image/png');
      saveState();
      hint.textContent = 'saved';
      renderCardSig();
    }
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.signature = null;
    hasInk = false;
    hint.textContent = 'Sign above';
    saveState();
    renderCardSig();
  });

  // Restore previous signature if exists
  if (state.signature) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      hasInk = true;
      hint.textContent = 'saved';
    };
    img.src = state.signature;
  }
}

function renderSignature() {
  // Initial render handled by initSignaturePad
}

// ============================================================
// CARD OPTIONS
// ============================================================
function renderCardOptions() {
  // Seismic ID
  const idDisplay = document.getElementById('seismicIdDisplay');
  const cardId = document.getElementById('cardSeismicId');
  if (state.seismicId) {
    idDisplay.textContent = state.seismicId;
    cardId.textContent = state.seismicId;
  }

  // Theme
  const themeSeg = document.getElementById('cardTheme');
  themeSeg.querySelectorAll('.seg__opt').forEach(btn => {
    const active = btn.dataset.theme === state.theme;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', active);
    btn.onclick = () => {
      state.theme = btn.dataset.theme;
      saveState();
      renderCardOptions();
      renderCard();
    };
  });

  // Finish
  const finSeg = document.getElementById('cardFin');
  finSeg.querySelectorAll('.seg__opt').forEach(btn => {
    const active = btn.dataset.fin === state.finish;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', active);
    btn.onclick = () => {
      state.finish = btn.dataset.fin;
      saveState();
      renderCardOptions();
      renderCard();
    };
  });

  // Regen ID + copy + verify link
  const copyBtn = document.getElementById('copyIdBtn');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (!state.seismicId) return;
      try {
        await navigator.clipboard.writeText(state.seismicId);
        const orig = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
        setTimeout(() => { copyBtn.innerHTML = orig; }, 1500);
        toast('Seismic ID copied', 'ok');
      } catch {
        toast('Copy failed', 'err');
      }
    };
  }

  const verifyLink = document.getElementById('verifyLink');
  if (verifyLink) {
    verifyLink.href = state.seismicId
      ? `${CONFIG.VERIFY_BASE}${state.seismicId}`
      : '#';
  }

  document.getElementById('regenId').onclick = () => {
    if (!confirm('Generate a new Seismic ID? Your old one will no longer be valid.')) return;
    state.seismicId = generateSeismicId();
    state.issued = new Date().toISOString();
    saveState();
    renderCardOptions();
    renderCard();
    toast('New Seismic ID generated', 'ok');
  };
}

// ============================================================
// CARD RENDER
// ============================================================
function renderCard() {
  const card = document.getElementById('card');
  card.dataset.theme = state.theme;
  card.dataset.fin = state.finish;

  // PFP
  const pfpEl = document.getElementById('cardPfp');
  if (state.x?.pfp) {
    pfpEl.innerHTML = `<img src="${escapeHtml(state.x.pfp)}" alt="" crossorigin="anonymous" onerror="this.parentElement.innerHTML='<i class=\\'ph ph-user\\' aria-hidden=\\'true\\'></i>'">`;
  } else {
    pfpEl.innerHTML = `<i class="ph ph-user" aria-hidden="true"></i>`;
  }

  // Name + handle
  document.getElementById('cardName').textContent = state.x?.name || 'Display name';
  const handleEl = document.getElementById('cardHandle');
  if (state.x) {
    handleEl.textContent = `@${state.x.handle}`;
    handleEl.href = `https://x.com/${encodeURIComponent(state.x.handle)}`;
  } else {
    handleEl.textContent = '@handle';
    handleEl.href = '#';
  }

  // Verified
  const verEl = document.getElementById('cardVerified');
  const verLabel = document.getElementById('cardVerifiedLabel');
  if (!state.x) {
    verEl.dataset.state = 'unverified';
    verLabel.textContent = 'No profile';
  } else if (state.x.source === 'oauth') {
    verEl.dataset.state = 'verified';
    verLabel.textContent = 'Verified via X';
  } else {
    verEl.dataset.state = 'self-submitted';
    verLabel.textContent = 'Self-submitted';
  }

  // Role
  const roleEl = document.getElementById('cardRole');
  if (state.discord?.inSeismicGuild) {
    roleEl.classList.remove('card__role--none');
    roleEl.textContent = state.discord.role || 'Seismic Member';
  } else {
    roleEl.classList.add('card__role--none');
    roleEl.textContent = '—';
  }

  // Issued date
  if (state.issued) {
    const d = new Date(state.issued);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    document.getElementById('cardIssued').textContent = `${yyyy}.${mm}.${dd}`;
  }

  // Signature
  renderCardSig();

  // QR
  renderQR();
}

function renderCardSig() {
  const box = document.getElementById('cardSigBox');
  if (state.signature) {
    box.innerHTML = `<img src="${state.signature}" alt="Signature">`;
  } else {
    box.innerHTML = `<i class="ph ph-pen-nib card__sig-placeholder" aria-hidden="true"></i>`;
  }
}

function renderQR() {
  const qrEl = document.getElementById('cardQr');
  qrEl.innerHTML = '';
  if (!state.seismicId) return;

  // Load QR lib if not ready
  if (typeof QRCode === 'undefined') {
    setTimeout(renderQR, 200);
    return;
  }

  // Use first 12 chars of ID for compact QR payload
  const payload = `${CONFIG.VERIFY_BASE}${state.seismicId}`;
  qrInstance = new QRCode(qrEl, {
    text: payload,
    width: 72,
    height: 72,
    colorDark: '#0a0907',
    colorLight: '#f4ede4',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// ============================================================
// EXPORT
// ============================================================
function renderExport() {
  document.getElementById('exportPng').onclick = exportPng;
  document.getElementById('exportPdf').onclick = exportPdf;
  document.getElementById('shareX').onclick = shareToX;
}

async function exportPng() {
  const card = document.getElementById('card');
  toast('Rendering PNG…');

  try {
    const canvas = await html2canvas(card, {
      backgroundColor: null,
      scale: 3, // high-res
      useCORS: true,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = `seismic-id-${state.seismicId || 'card'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('PNG downloaded', 'ok');
  } catch (e) {
    console.error('PNG export failed:', e);
    toast('PNG export failed', 'err');
  }
}

async function exportPdf() {
  const card = document.getElementById('card');
  toast('Rendering PDF…');

  try {
    const canvas = await html2canvas(card, {
      backgroundColor: '#0a0907',
      scale: 3,
      useCORS: true,
      logging: false,
    });
    const imgData = canvas.toDataURL('image/png');

    // Card is 3:5 — letter portrait page, card centered
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // Card max dimensions
    const cardW = 90;
    const cardH = 150; // 3:5
    const x = (pageW - cardW) / 2;
    const y = (pageH - cardH) / 2 - 10;

    pdf.addImage(imgData, 'PNG', x, y, cardW, cardH);

    // Footer
    pdf.setFontSize(8);
    pdf.setTextColor(150, 130, 110);
    pdf.text(`Seismic Community ID · ${state.seismicId || ''}`, pageW / 2, pageH - 20, { align: 'center' });
    pdf.text(`Generated ${new Date().toISOString().split('T')[0]} · seismic-identity.vercel.app`, pageW / 2, pageH - 14, { align: 'center' });

    pdf.save(`seismic-id-${state.seismicId || 'card'}.pdf`);
    toast('PDF downloaded', 'ok');
  } catch (e) {
    console.error('PDF export failed:', e);
    toast('PDF export failed', 'err');
  }
}

function shareToX() {
  const name = state.x?.name || 'Seismic member';
  const handle = state.x?.handle || 'anonymous';
  const role = state.discord?.inSeismicGuild ? (state.discord.role || 'Seismic Member') : null;
  const text = CONFIG.SHARE_TEXT(name, handle, role);
  const url = window.location.origin;
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intentUrl, '_blank', 'noopener,noreferrer');
}

// ============================================================
// VERIFY DIALOG
// ============================================================
function initVerifyDialog() {
  const dialog = document.getElementById('verifyDialog');
  const openLinks = document.querySelectorAll('a[href="#verify"]');
  const closeBtns = document.querySelectorAll('[data-close-dialog]');
  const checkBtn = document.getElementById('verifyCheck');
  const input = document.getElementById('verifyInput');
  const result = document.getElementById('verifyResult');

  openLinks.forEach(l => l.addEventListener('click', (e) => {
    e.preventDefault();
    dialog.showModal();
    input.focus();
  }));
  closeBtns.forEach(b => b.addEventListener('click', () => dialog.close()));

  checkBtn.addEventListener('click', () => {
    const id = input.value.trim().toUpperCase();
    if (!id) {
      result.hidden = false;
      result.className = 'verify-result verify-result--err';
      result.textContent = 'Enter a Seismic ID.';
      return;
    }
    if (id === (state.seismicId || '').toUpperCase()) {
      result.hidden = false;
      result.className = 'verify-result verify-result--ok';
      result.innerHTML = `<strong>Verified.</strong> This browser issued ${escapeHtml(id)}. Cross-browser verification requires a backend, which this MVP intentionally skips for privacy.`;
    } else {
      result.hidden = false;
      result.className = 'verify-result verify-result--err';
      result.innerHTML = `<strong>Not in this browser.</strong> Seismic IDs are stored locally for privacy. To verify a different ID, the issuer must share their device or a signed proof.`;
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkBtn.click();
  });
}

// ============================================================
// RESET
// ============================================================
function initReset() {
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset your card? This clears all data from this browser.')) return;
    clearState();
    toast('Card reset', 'ok');
    showView('connect');
  });
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function toast(message, type = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type ? `toast--${type}` : ''}`;
  el.hidden = false;
  // Force reflow
  void el.offsetWidth;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2400);
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initConnectView();
  initSignaturePad();
  initVerifyDialog();
  initReset();
  determineInitialView();
});

// Re-render card on window resize (QR + signature)
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!document.getElementById('view-builder').hidden) {
      renderQR();
    }
  }, 200);
});
