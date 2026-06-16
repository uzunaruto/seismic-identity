// api/discord/auth.js — Vercel serverless
// Initiates Discord OAuth2 flow.
// Required env vars:
//   DISCORD_CLIENT_ID       — from Discord Developer Portal
//   DISCORD_CLIENT_SECRET   — from Discord Developer Portal (server-side only)
//   DISCORD_REDIRECT_URI    — e.g. https://seismic-identity.vercel.app/api/discord/callback

const SCOPES = ['identify', 'guilds'].join(' ');

export default async function handler(req, res) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send(
      'Discord OAuth not configured. Set DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI env vars in Vercel.'
    );
  }

  // Generate a CSRF state token
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });

  res.setHeader('Set-Cookie', `discord_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  res.redirect(302, `https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
