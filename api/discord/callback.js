// api/discord/callback.js — Vercel serverless
// Handles Discord OAuth2 callback:
//  1. Validates state (CSRF)
//  2. Exchanges code for access token
//  3. Fetches user info + guilds
//  4. Checks if user is in the Seismic guild
//  5. Looks up known role mapping
//  6. Redirects to /#discord=<base64-encoded JSON>

const SEISMIC_GUILD_ID = '1343751435711414362';
// Edit this map (Discord user ID -> role label) to whitelist specific roles.
// Format: 'DISCORD_USER_SNOWFLAKE_ID': 'Magnitude'
const KNOWN_ROLES = {
  // Example: '853265485178957834': 'Magnitude',
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (req.headers.origin || 'http://localhost:3000');

  if (error) {
    return res.redirect(`${baseUrl}/?discord_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Validate state
  const cookies = parseCookies(req.headers.cookie);
  if (!state || cookies.discord_oauth_state !== state) {
    return res.status(400).send('Invalid state (CSRF check failed). Please retry.');
  }

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send('Discord OAuth not configured');
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('Discord token exchange failed:', t);
      return res.status(502).send('Token exchange failed');
    }
    const token = await tokenRes.json();
    const accessToken = token.access_token;

    // 2. Fetch user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return res.status(502).send('Failed to fetch Discord user');
    }
    const user = await userRes.json();

    // 3. Fetch guilds
    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const guilds = guildsRes.ok ? await guildsRes.json() : [];
    const inSeismicGuild = Array.isArray(guilds) && guilds.some(g => g.id === SEISMIC_GUILD_ID);

    // 4. Look up role
    const role = KNOWN_ROLES[user.id] || 'Seismic Member';

    // 5. Encode and redirect
    const payload = {
      id: user.id,
      username: user.username,
      global_name: user.global_name,
      inSeismicGuild,
      role: inSeismicGuild ? role : null,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

    // Clear state cookie
    res.setHeader('Set-Cookie', 'discord_oauth_state=; Path=/; HttpOnly; Max-Age=0');
    res.redirect(302, `${baseUrl}/#discord=${encoded}`);
  } catch (e) {
    console.error('Discord callback error:', e);
    res.status(500).send('OAuth flow failed');
  }
}
