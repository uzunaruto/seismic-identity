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

  SHARE_TEXT: (name, handle, role, magnitude, seismicId) => {
    const r = role ? ` · ${role}` : '';
    const m = magnitude ? ` · Magnitude ${magnitude}` : '';
    const id = seismicId ? `\n\nVerify: ${CONFIG.VERIFY_BASE}${seismicId}` : '';
    return `Just opened my Seismic passport. ${name}${handle ? ` (@${handle})` : ''}${r}${m}. No wallet, just identity. #SeismicID` + id;
  },
};

// ============================================================
// STATE
// ============================================================
const defaultState = {
  identity: null,    // { source, id, name, handle, pfp, role, magnitude, tier, joinedAt }
  region: '',        // user-entered country/region
  signature: null,   // dataURL
  seismicId: null,
  issued: null,
  ratio: 'landscape', // passport is landscape-only
  theme: 'parchment', // parchment (only theme — passport locks the look)
  finish: 'matte',   // matte | holographic
  avatar: 'circle',  // circle | squircle | hex
  border: 'minimal', // minimal | glow | stamp
  xHandle: '',       // X @handle (links to X profile, optional)
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
    const merged = { ...defaultState, ...parsed };
    // one-time migration: old customTitle -> xHandle
    if (parsed.customTitle && !merged.xHandle) {
      merged.xHandle = parsed.customTitle;
    }
    return merged;
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
// IDENTITY RESOLUTION — Discord is identity source, X is link
// ============================================================
// Returns the effective values shown on the card with priority:
//   1. Discord (state.identity.name/pfp/handle) — primary identity photo + name
//   2. Manual identity (state.identity from connect form) — fallback for no-Discord
//   3. X handle (state.xHandle) — link to X profile, optional
// Discord role/magnitude/joinedAt/roleIds/region stay on state.identity separately.
function getDisplayName() {
  // Prefer Discord global_name (display name) → username → legacy name
  if (state.identity && state.identity.discordNick) return state.identity.discordNick;
  if (state.identity && state.identity.name) return state.identity.name;
  return '';
}
function getDisplayPfp() {
  // Discord avatar URL is the canonical photo source
  if (state.identity && state.identity.pfp) return state.identity.pfp;
  if (state.identity && state.identity.discordPfp) return state.identity.discordPfp;
  return '';
}
function getDisplayHandle() {
  // X handle takes priority (links to X profile), fall back to Discord username
  if (state.xHandle && state.xHandle.trim()) return state.xHandle.trim().replace(/^@/, '');
  if (state.identity && state.identity.handle) return state.identity.handle;
  return '';
}
function getDisplayRole() {
  // Discord verification takes priority (auto-detected Magnitude)
  if (state.identity && state.identity.role) return state.identity.role;
  // Fallback to manual role from connect form
  if (state.identity && state.identity.role === null && state.identity.tier === 'self') {
    // self-declared Magnitude is on identity.role via the manual form
  }
  return (state.identity && state.identity.role) || null;
}
function getDisplayMagnitude() {
  if (state.identity && state.identity.magnitude) return state.identity.magnitude;
  if (state.identity && state.identity.role) return detectMagnitude(state.identity.role);
  return null;
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
// Discord role IDs → Magnitude tier (sourced from seismic-cards.vercel.app)
// Used by the implicit OAuth flow to read user.roles from guilds.members.read
const MAG_ROLE_IDS = {
  '1346572989654765691': 3,
  '1346583232220500051': 4,
  '1346583465704951879': 5,
  '1346583601025781760': 6,
  '1346583708018278481': 7,
  '1346583804630011914': 8,
  '1346583929473335429': 9,
};

function detectMagnitudeFromRoles(roleIds) {
  if (!Array.isArray(roleIds) || !roleIds.length) return null;
  let highest = 0;
  for (const id of roleIds) {
    const mag = MAG_ROLE_IDS[id];
    if (mag && mag > highest) highest = mag;
  }
  return highest || null;
}

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
  if (hash.includes('access_token=') || hash.includes('error=')) {
    handleDiscordCallback().then((handled) => {
      if (handled) return; // showView('builder') was called inside
      if (state.identity) showView('builder');
      else showView('connect');
    });
    return;
  }
  if (state.identity) {
    showView('builder');
  } else {
    showView('connect');
  }
}

// ============================================================
// DISCORD OAUTH — IMPLICIT TOKEN FLOW (no backend needed)
// ============================================================
// Client-side OAuth using response_type=token. The access token comes back
// in the URL hash, which we use directly to call Discord API.
// Scopes: 'identify guilds.members.read' lets us read the user's roles in
// any guild the OAuth app is a member of (the Seismic guild).
const DISCORD_CLIENT_ID = '1509035141526192299';
const SEISMIC_GUILD_ID  = '1343751435711414362';
const DISCORD_REDIRECT  = 'https://seismic-identity.vercel.app/'; // back to root
const DISCORD_SCOPES    = 'identify guilds.members.read';

function startDiscordAuth() {
  // Wipe localStorage so the new connection doesn't merge with old data
  // (preserves seismicId so we don't churn passport IDs)
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT,
    response_type: 'token',
    scope: DISCORD_SCOPES,
    prompt: 'consent',
  });
  location.href = `https://discord.com/oauth2/authorize?${params}`;
}

function discordAvatarUrl(user, guildMember) {
  if (guildMember && guildMember.avatar) {
    return `https://cdn.discordapp.com/guilds/${SEISMIC_GUILD_ID}/users/${user.id}/avatars/${guildMember.avatar}.png?size=256`;
  }
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
  }
  // Default avatar
  const idx = Number(BigInt(user.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function fetchDiscordMember(token) {
  const [uRes, mRes] = await Promise.all([
    fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`https://discord.com/api/v10/users/@me/guilds/${SEISMIC_GUILD_ID}/member`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (!uRes.ok) throw new Error(`Discord /users/@me failed: ${uRes.status}`);
  const user = await uRes.json();
  const member = mRes.ok ? await mRes.json() : null;
  return { user, member };
}

async function handleDiscordCallback() {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  if (!accessToken) return false;
  // Clear the hash so the token doesn't sit in the URL bar
  history.replaceState(null, '', window.location.pathname);

  toast && toast('Scanning Discord roles…');
  try {
    const { user, member } = await fetchDiscordMember(accessToken);
    if (!member) {
      toast('Not in the Seismic Discord. Join first, then retry.', 'err');
      return true;
    }
    const roleIds = member.roles || [];
    const mag = detectMagnitudeFromRoles(roleIds);
    const role = mag ? `Magnitude ${mag}` : (member.roles.length ? 'Seismic Member' : null);
    const joinedAt = member.joined_at ? member.joined_at.slice(0, 10) : null;
    const avatar = discordAvatarUrl(user, member);
    // Discord name resolution: global_name (display name set by user) → username → 'Seismic Citizen'
    // We always overwrite identity.name/pfp/handle from Discord so the card reflects the
    // current Discord profile, not stale manual-form data.
    const discordName = user.global_name || user.username || 'Seismic Citizen';

    // Merge: Discord now IS the identity source for name/PFP/handle.
    // Role/joined/region still come from guild membership.
    state.identity = state.identity || { source: 'discord' };
    state.identity.source = 'discord';
    state.identity.discordId = user.id;
    state.identity.discordUsername = user.username;
    state.identity.discordNick = member.nick || user.global_name || null;
    state.identity.name = discordName;            // ← card NAME comes from Discord
    state.identity.handle = user.username;        // ← card HANDLE base = Discord username
    state.identity.pfp = avatar;                  // ← card PFP comes from Discord
    state.identity.role = role;
    state.identity.roleIds = roleIds;
    state.identity.magnitude = mag;
    state.identity.tier = mag ? 'verified' : 'self';
    state.identity.inGuild = true;
    state.identity.joinedAt = joinedAt;
    state.identity.discordPfp = avatar;
    state.region = state.region || 'Indonesia'; // fallback if no manual region

    if (!state.seismicId) {
      state.seismicId = generateSeismicId();
      state.issued = new Date().toISOString();
    }
    saveState();
    const magLabel = mag ? `Magnitude ${mag}` : 'member';
    toast(`Discord verified · ${magLabel}`, 'ok');
    showView('builder');
    return true;
  } catch (e) {
    console.error('Discord callback failed:', e);
    toast('Discord connection failed. Try again.', 'err');
    return true;
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
    const region = document.getElementById('mRegion').value.trim();

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
      joinedAt: null,
    };
    state.region = region || '';
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
  renderXHandleInput();
  renderXIdentityInputs();
  renderRegionInput();
  renderCard();
  renderExport();
  initSignaturePad();
}

function renderRegionInput() {
  const input = document.getElementById('regionInput');
  if (!input) return;
  if (input.value !== state.region) input.value = state.region || '';
  input.oninput = () => {
    state.region = input.value;
    saveState();
    renderCard();
  };
}

function renderIdentityCard() {
  const id = state.identity;
  const pfp = document.getElementById('idPfp');
  const name = document.getElementById('idName');
  const handle = document.getElementById('idHandle');
  const roleEl = document.getElementById('idRole');
  const roleText = document.getElementById('idRoleText');

  const effName   = getDisplayName();
  const effPfp    = getDisplayPfp();
  const effHandle = getDisplayHandle();
  const effRole   = getDisplayRole();
  const effMag    = getDisplayMagnitude();

  if (!id) {
    name.textContent = '— no identity —';
    handle.textContent = 'Connect Discord or fill the manual form';
    pfp.style.backgroundImage = '';
    roleEl.hidden = true;
    return;
  }
  name.textContent = effName || '—';
  handle.textContent = effHandle
    ? '@' + effHandle
    : (id.source === 'discord' ? `discord · ${(id.discordId || id.id || '').slice(-4) || '?'}` : 'self-submitted');
  pfp.style.backgroundImage = effPfp ? `url('${effPfp}')` : '';
  if (effRole) {
    roleEl.hidden = false;
    roleText.textContent = effRole;
    roleEl.dataset.roleKind = detectRoleKind(effRole);
    roleEl.dataset.magnitude = effMag || '';
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

function renderXHandleInput() {
  const input = document.getElementById('xHandleInput');
  if (!input) return;
  input.value = state.xHandle || '';
  input.oninput = () => {
    const v = input.value.trim().replace(/^@/, '');
    if (v && !/^[A-Za-z0-9_]{1,32}$/.test(v)) {
      input.setCustomValidity('Handle: letters, digits, underscore only');
    } else {
      input.setCustomValidity('');
    }
    state.xHandle = v;
    saveState();
    renderCard();
  };
}

function renderXIdentityInputs() {
  // The X PFP URL and X display name inputs were removed in v6.5.
  // PFP and name now come from Discord (state.identity.pfp / state.identity.name).
  // X handle is the only X-sourced field, handled by renderXHandleInput().
  // This function is kept as a no-op so existing call sites don't break,
  // and we use it for the Discord verify button label refresh.
  const verifyLabel = document.getElementById('discordVerifyLabel');
  if (verifyLabel) {
    const verified = state.identity && state.identity.roleIds && state.identity.roleIds.length;
    if (verified) {
      verifyLabel.textContent = `Re-verify Discord · ${state.identity.role}`;
    } else {
      verifyLabel.textContent = 'Re-verify Discord role';
    }
  }
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
    ctx.strokeStyle = '#2a1f12';  // dark ink — visible on cream builder bg, mirrors card ink
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
    // CRITICAL: e.touches is null on touchend, so guard against that.
    // For touchstart/touchmove use touches[0]; for mouse events use the event itself.
    let cx, cy;
    if (e.touches && e.touches.length) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length) {
      // touchend path: touches is empty, use changedTouches to get the released finger
      cx = e.changedTouches[0].clientX;
      cy = e.changedTouches[0].clientY;
    } else {
      cx = e.clientX;
      cy = e.clientY;
    }
    return { x: cx - rect.left, y: cy - rect.top };
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
  function end(e) {
    if (!drawing) return;
    if (e && e.preventDefault) e.preventDefault();
    drawing = false;
    if (sigHasInk) {
      state.signature = canvas.toDataURL('image/png');
      saveState();
      hint.textContent = 'saved';
      renderCardSig();
    }
  }

  // CRITICAL: addEventListener with {passive:false} is required for preventDefault()
  // to actually block page scroll/zoom on touch. Setting .ontouchstart makes the
  // listener passive on most modern browsers, which causes the page to scroll under
  // the finger while drawing — making the ink appear to drift (usually right) from
  // the touch point. Using addEventListener with passive:false fixes this.
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });

  clearBtn.onclick = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.signature = null;
    sigHasInk = false;
    hint.textContent = 'Sign above';
    saveState();
    renderCardSig();
  };

  // Re-sync the canvas bitmap to its CSS size whenever the parent layout changes.
  // Without this, if the canvas is rendered while hidden (or its container is
  // resized after init), rect.width/height at setup() time can be stale, and
  // subsequent draws use the wrong coordinate space — producing a visible
  // horizontal/vertical offset between finger and ink.
  const ro = new ResizeObserver(() => {
    if (sigHasInk && state.signature) {
      // Don't resize after the user has drawn — that would wipe their work.
      return;
    }
    setup();
  });
  ro.observe(canvas);
}

function renderCardSig() {
  const box = document.getElementById('cardSig');
  if (!box) return;
  if (state.signature) {
    box.classList.remove('is-empty');
    box.innerHTML = `<img src="${state.signature}" alt="Signature">`;
  } else {
    box.classList.add('is-empty');
    box.textContent = 'Seismic';
  }
}

// ============================================================
// REGION + DATE HELPERS
// ============================================================
const REGION_FLAGS = {
  'indonesia': '🇮🇩', 'singapore': '🇸🇬', 'united states': '🇺🇸', 'usa': '🇺🇸',
  'india': '🇮🇳', 'philippines': '🇵🇭', 'vietnam': '🇻🇳', 'thailand': '🇹🇭',
  'japan': '🇯🇵', 'south korea': '🇰🇷', 'korea': '🇰🇷', 'australia': '🇦🇺',
  'brazil': '🇧🇷', 'nigeria': '🇳🇬', 'united kingdom': '🇬🇧', 'uk': '🇬🇧',
  'germany': '🇩🇪', 'france': '🇫🇷', 'turkey': '🇹🇷', 'argentina': '🇦🇷',
  'canada': '🇨🇦', 'uae': '🇦🇪', 'malaysia': '🇲🇾', 'mexico': '🇲🇽',
  'spain': '🇪🇸', 'italy': '🇮🇹', 'netherlands': '🇳🇱', 'russia': '🇷🇺',
  'china': '🇨🇳', 'taiwan': '🇹🇼', 'pakistan': '🇵🇰', 'bangladesh': '🇧🇩',
  'egypt': '🇪🇬', 'south africa': '🇿🇦', 'kenya': '🇰🇪',
};

function flagForRegion(region) {
  if (!region) return '🌐';
  return REGION_FLAGS[region.trim().toLowerCase()] || '🌐';
}

function formatJoinedDate(isoOrDate) {
  if (!isoOrDate) return null;
  // accept "2024-08-15" or ISO string or Date
  let d;
  if (isoOrDate instanceof Date) d = isoOrDate;
  else if (typeof isoOrDate === 'string') {
    d = new Date(isoOrDate.includes('T') ? isoOrDate : isoOrDate + 'T00:00:00Z');
  } else return null;
  if (isNaN(d.getTime())) return null;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day} / ${month} / ${year}`;
}

function formatTenure(isoOrDate) {
  if (!isoOrDate) return null;
  let d;
  if (isoOrDate instanceof Date) d = isoOrDate;
  else if (typeof isoOrDate === 'string') {
    d = new Date(isoOrDate.includes('T') ? isoOrDate : isoOrDate + 'T00:00:00Z');
  } else return null;
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12
               + (now.getUTCMonth() - d.getUTCMonth());
  const years = Math.floor(months / 12);
  const remMonths = months - years * 12;
  if (years >= 2) return `${years} YEARS`;
  if (years === 1) return remMonths > 0 ? `1 YR ${remMonths} MO` : `1 YEAR`;
  if (months >= 1) return `${months} MONTHS`;
  const days = Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86400000));
  return `${days} DAYS`;
}

// deterministic barcode widths from a seed string (so the barcode is stable for the same ID)
function barcodeBars(seed, count = 50) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    // widths: 1, 2, 3 alternating with gap = 0
    const w = (h % 3) + 1;
    bars.push(w);
  }
  return bars;
}

function renderBarcode() {
  const container = document.getElementById('cardBarcode');
  if (!container) return;
  container.innerHTML = '';
  const seed = state.seismicId || 'SEI-0000-0000-0000';
  const bars = barcodeBars(seed, 60);
  for (const w of bars) {
    const span = document.createElement('span');
    span.style.width = `${w}px`;
    if ((bars.indexOf(w) % 4) === 3) {
      // gap
      span.style.background = 'transparent';
      span.style.width = '2px';
    }
    container.appendChild(span);
  }
}

// ============================================================
// CARD RENDER (PASSPORT)
// ============================================================
function renderCard() {
  const card = document.getElementById('card');
  if (!card) return;

  // data attributes (no theme/ratio for passport — locked to parchment/landscape)
  card.dataset.theme = 'parchment';
  card.dataset.finish = state.finish;
  card.dataset.avatar = state.avatar;
  card.dataset.border = state.border;

  const id = state.identity;
  const pfp = document.getElementById('cardPfp');
  const name = document.getElementById('cardName');
  const handle = document.getElementById('cardHandle');
  const roleEl = document.getElementById('cardRole');
  const magEl = document.getElementById('cardMagnitude');
  const magValue = document.getElementById('cardMagnitudeValue');
  const joined = document.getElementById('cardJoined');
  const regionName = document.getElementById('cardRegionName');
  const regionFlag = document.getElementById('cardFlag');
  const seismicId = document.getElementById('cardSeismicId');

  // Resolve effective identity values (X > manual > Discord fallback)
  const effName   = getDisplayName();
  const effPfp    = getDisplayPfp();
  const effHandle = getDisplayHandle();
  const effRole   = getDisplayRole();
  const effMag    = getDisplayMagnitude();

  // ----- NAME -----
  if (effName) {
    name.textContent = effName.toString().toUpperCase().slice(0, 18);
  } else {
    name.textContent = 'NAME';
  }

  // ----- HANDLE (X) -----
  if (effHandle) {
    handle.textContent = '@' + effHandle;
    handle.href = `https://x.com/${effHandle}`;
  } else {
    handle.textContent = '— not set —';
    handle.href = '#';
  }
  // inline handle inside nameplate (compact display)
  const handleInline = document.getElementById('cardHandleInline');
  if (handleInline) {
    handleInline.textContent = effHandle ? '@' + effHandle : '— not connected —';
  }

  // ----- PFP -----
  // Render the avatar. We use background-image on the container
  // (which html2canvas can render synchronously) AND an <img> tag
  // (so the live preview is sharp and accessible). The two are kept
  // in sync — the img provides the on-screen pixel-perfect render,
  // the background is a fallback for the html2canvas export pipeline
  // which sometimes struggles with <img> tags in the cloned DOM.
  if (effPfp) {
    pfp.style.backgroundImage = `url('${escapeHtml(effPfp)}')`;
    pfp.style.backgroundSize = 'cover';
    pfp.style.backgroundPosition = 'center';
    pfp.innerHTML = `<img src="${escapeHtml(effPfp)}" alt="">`;
  } else {
    pfp.style.backgroundImage = '';
    pfp.innerHTML = '<i class="ph ph-user"></i>';
  }

  // ----- ROLE / MAGNITUDE -----
  const roleText = effRole || 'Seismic Member';
  const mag = effMag;
  roleEl.textContent = roleText;
  roleEl.dataset.magnitude = mag ? String(mag) : '';
  if (mag) {
    magValue.textContent = String(mag);
    magEl.dataset.magnitude = String(mag);
    const tierEl = document.getElementById('cardMagnitudeTier');
    if (tierEl) tierEl.textContent = 'TIER ' + String(mag);
  } else {
    magValue.textContent = '—';
    magEl.dataset.magnitude = '';
    const tierEl = document.getElementById('cardMagnitudeTier');
    if (tierEl) tierEl.textContent = 'UNRANKED';
  }

  // ----- JOINED -----
  const joinedDate = id && id.joinedAt;
  joined.textContent = formatJoinedDate(joinedDate) || '— · — · —';

  // ----- TENURE (citizen since) -----
  const tenureEl = document.getElementById('cardTenure');
  if (tenureEl) {
    tenureEl.textContent = formatTenure(joinedDate) || 'NEW CITIZEN';
  }

  // ----- REGION -----
  const region = (state.region || '').trim();
  if (region) {
    regionName.textContent = region.toUpperCase().slice(0, 24);
    regionFlag.textContent = flagForRegion(region);
  } else {
    regionName.textContent = 'UNSET';
    regionFlag.textContent = '🌐';
  }

  // ----- SEISMIC ID -----
  seismicId.textContent = state.seismicId || 'SEI-0000-0000-0000';

  // ----- COPY LABEL -----
  const copyLabel = document.getElementById('copyIdLabel');
  if (copyLabel) {
    copyLabel.textContent = state.seismicId ? state.seismicId.slice(0, 8) + '…' : 'SEI-…';
  }

  // ----- SIGNATURE -----
  renderCardSig();

  // ----- BARCODE -----
  renderBarcode();
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

// Convert an <img> element to a PNG data URL after waiting for it to load.
// Returns null if the image is missing, failed to load, or is CORS-tainted.
// Used by exportCardImage to pre-load PFP and brand logo into a format that
// html2canvas can capture synchronously (the clone created by html2canvas
// doesn't carry the original <img>'s load state, so any src set inside
// onclone is loaded asynchronously and renders as a blank box).
async function imageToDataUrl(imgEl) {
  if (!imgEl) return null;
  if (!imgEl.complete || imgEl.naturalWidth === 0) {
    await new Promise((resolve) => {
      imgEl.addEventListener('load', resolve, { once: true });
      imgEl.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
  }
  if (imgEl.naturalWidth === 0) return null;
  try {
    const c = document.createElement('canvas');
    c.width  = imgEl.naturalWidth;
    c.height = imgEl.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) {
    // CORS-tainted canvas — return the original src as a fallback
    return imgEl.src || null;
  }
}

// Fetch a URL (data URL or remote) and return it as a data URL string.
// Used for pre-loading the user-drawn signature PNG, which is stored as
// a data URL in state.signature but may be large enough that the browser
// hasn't fully decoded it by the time html2canvas runs.
async function fetchAsDataUrl(url) {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return url;
    const resp = await fetch(url, { mode: 'cors' });
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return url; // fallback
  }
}

async function exportCardImage(format) {
  // Pre-load all web fonts before rendering. html2canvas captures the
  // element synchronously, so if Outfit/JetBrains Mono/Caveat haven't
  // finished loading it falls back to a system font that looks very
  // different (this was the #1 cause of "kacau" mobile vs desktop
  // exports — the fallback was rendering at a different size/weight).
  try {
    await document.fonts.ready;
    // Force-load the specific font weights we use
    await Promise.all([
      document.fonts.load('700 32px "Outfit"'),
      document.fonts.load('600 18px "Outfit"'),
      document.fonts.load('500 14px "Outfit"'),
      document.fonts.load('400 12px "Outfit"'),
      document.fonts.load('600 12px "JetBrains Mono"'),
      document.fonts.load('500 11px "JetBrains Mono"'),
      document.fonts.load('700 28px "Caveat"'),
    ]);
  } catch (e) { /* fonts not available, continue with fallback */ }

  // Render the frame directly instead of #card. html2canvas clips
  // the bottom of #card due to a flex+overflow interaction in the
  // card wrapper, but the frame renders the full 720x470 correctly.
  const card = document.querySelector('.passport__frame');
  if (!card) {
    toast('Card not found', 'err');
    return;
  }

  // Pre-convert PFP and brand logo to PNG data URLs that are GUARANTEED
  // to be loaded by the time the export runs. Doing the drawImage+toDataURL
  // inside onclone is too late — the browser starts loading the new src
  // asynchronously, and the clone is rasterized before the load
  // completes, producing an empty box where the avatar should be.
  const pfpDataUrl = await imageToDataUrl(document.querySelector('#cardPfp img'));
  const brandDataUrl = await imageToDataUrl(document.querySelector('.passport__brand-img'));
  // Pre-load the signature PNG if the user drew one
  let sigDataUrl = null;
  if (state.signature) {
    sigDataUrl = await fetchAsDataUrl(state.signature);
  }

  toast('Rendering passport…', 'info');
  try {
    // Export via html-to-image (SVG foreignObject rasterizer).
    //
    // Why we switched from html2canvas → html-to-image:
    //   html2canvas v1.x CANNOT reliably produce a true 3x export of this
    //   passport layout. Three approaches all broke:
    //     - scale:3 + width:720/height:470 → elements positioned using
    //       live-DOM coordinates (transform: scale(0.88) on desktop,
    //       scale(0.52) on mobile) end up shifted off-canvas. Right page
    //       rendered as black, data rows lost.
    //     - scale:3 + transform reset in onclone → silently dropped flex
    //       children from the rasterized output (data row text missing).
    //     - scale:1 + width/height + manual 3x Canvas API upscale →
    //       produces correct 2160x1410 PNG, but the upscale smooths the
    //       720x470 source so the file looks "blurry" at 1:1 pixel zoom
    //       (1.1MB file with 720x470 worth of real detail stretched over
    //       2160x1410 area). User feedback: "download perkecil dan blur".
    //
    //   html-to-image uses SVG <foreignObject> with the browser's native
    //   renderer, so pixelRatio: 3 produces TRUE 3x pixels at the
    //   declared 720x470 size (2160x1410 = 4.6MB), identical regardless
    //   of viewport. No transform, no upscale, no position math bugs.
    //
    // canvas is needed for jsPDF embedding (jsPDF.addImage takes canvas,
    // not data URL). html-to-image also returns a canvas if requested.
    const exportScale = format === 'pdf' ? 3 : 3; // 3x for both PNG and PDF
    const blob = await htmlToImage.toBlob(card, {
      pixelRatio: exportScale,
      backgroundColor: '#1a1612',
      cacheBust: true,
      skipFonts: true,
      // Google Fonts CSS stylesheet during export. That fetch can fail
      // with CORS errors in some environments (private browsing, strict
      // cookie settings, certain proxies), which would hang the entire
      // export for 60+ seconds. We pre-load all needed font weights via
      // document.fonts.load() above, so the SVG <foreignObject> already
      // has them inlined. No need to re-fetch.
      // The onclone hook is also supported by html-to-image, with the
      // same fixes we had in html2canvas. Solid backgrounds, hide the
      // PFP <img> so the CSS background-image is the canonical source.
      onclone: (doc) => {
        const all = doc.querySelectorAll('*');
        all.forEach(el => {
          el.style.cssText += ';-webkit-font-smoothing:antialiased !important;-moz-osx-font-smoothing:grayscale !important;text-rendering:geometricPrecision !important;';
        });
        const left = doc.querySelector('.passport__page--left');
        const right = doc.querySelector('.passport__page--right');
        const parchment = '#d4c29a';
        if (left)  left.style.cssText  += `;background:${parchment} !important;`;
        if (right) right.style.cssText += `;background:${parchment} !important;`;
        const frame = doc.querySelector('.passport__frame');
        if (frame) frame.style.cssText += ';background:#1a1612 !important;';
        if (sigDataUrl) {
          const sigBox = doc.getElementById('cardSig');
          if (sigBox) {
            sigBox.innerHTML = `<img src="${sigDataUrl}" style="width:100%;height:100%;object-fit:contain;display:block">`;
          }
        }
        doc.querySelectorAll('#cardPfp img').forEach(img => {
          img.style.setProperty('display', 'none', 'important');
        });
      },
    });

    // Convert blob to canvas (for jsPDF) and data URL (for direct download).
    const canvas = await blobToCanvas(blob);
    if (format === 'png') {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${state.seismicId || 'seismic-passport'}.png`;
      link.href = url;
      link.click();
      // Free the blob URL after the download is initiated.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('PNG downloaded', 'ok');
    } else if (format === 'pdf') {
      if (!window.jspdf) { toast('PDF library not loaded', 'err'); return; }
      const { jsPDF } = window.jspdf;
      // Passport is always landscape (2160x1410 at 3x)
      const pdf = new jsPDF({
        orientation: 'l',
        unit: 'px',
        format: [canvas.width, canvas.height],
        hotfixes: ['px_scaling'],
      });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${state.seismicId || 'seismic-passport'}.pdf`);
      toast('PDF downloaded', 'ok');
    }
  } catch (e) {
    console.error('Export failed:', e);
    toast('Export failed', 'err');
  }
}

// Convert a Blob to an HTMLCanvasElement (used by PDF export path).
// Required because jsPDF.addImage needs a canvas / data URL, but
// html-to-image's native return type is a Blob.
async function blobToCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function shareToX() {
  if (!state.identity) {
    toast('Build your card first', 'err');
    return;
  }
  const effectiveHandle = state.xHandle || state.identity.handle;
  const text = CONFIG.SHARE_TEXT(
    state.identity.name,
    effectiveHandle,
    state.identity.role,
    state.identity.magnitude,
    state.seismicId
  );
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
  // Pre-load brand logo as data URL so html2canvas can capture it
  // without depending on cross-origin/cached-load state.
  preloadBrandLogo();
  initConnectView();
  initEditIdentity();
  initReset();
  determineInitialView();
}

async function preloadBrandLogo() {
  const img = document.querySelector('.passport__brand-img');
  if (!img) return;
  // Wait for the natural load first
  if (!img.complete || img.naturalWidth === 0) {
    await new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      // safety timeout — don't block forever
      setTimeout(resolve, 3000);
    });
  }
  if (img.naturalWidth === 0) return;
  try {
    const c = document.createElement('canvas');
    c.width  = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    img.src = c.toDataURL('image/png');
  } catch (e) {
    // CORS-tainted canvas — keep original src
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
