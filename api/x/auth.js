// api/x/auth.js — Vercel serverless
// Initiates X (Twitter) OAuth2 flow with PKCE.
// Required env vars:
//   X_CLIENT_ID          — from X Developer Portal
//   X_REDIRECT_URI       — e.g. https://seismic-identity.vercel.app/api/x/callback

const SCOPES = ['tweet.read', 'users.read'].join(' ');

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

export default async function handler(req, res) {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send(
      'X OAuth not configured. Set X_CLIENT_ID and X_REDIRECT_URI env vars in Vercel.'
    );
  }

  // PKCE
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64UrlEncode(await sha256(codeVerifier));
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  // Store verifier + state in HttpOnly cookies for callback
  const cookies = [
    `x_oauth_verifier=${codeVerifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    `x_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  ];
  res.setHeader('Set-Cookie', cookies);

  res.redirect(302, `https://twitter.com/i/oauth2/authorize?${params.toString()}`);
}
