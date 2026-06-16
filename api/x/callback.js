// api/x/callback.js — Vercel serverless
// Handles X OAuth2 callback with PKCE:
//  1. Validates state (CSRF)
//  2. Exchanges code + verifier for access token
//  3. Fetches user info
//  4. Redirects to /#x=<base64-encoded JSON>

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
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET; // optional for public client
  const redirectUri = process.env.X_REDIRECT_URI;
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (req.headers.origin || 'http://localhost:3000');

  if (error) {
    return res.redirect(`${baseUrl}/?x_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Validate state
  const cookies = parseCookies(req.headers.cookie);
  if (!state || cookies.x_oauth_state !== state) {
    return res.status(400).send('Invalid state (CSRF check failed). Please retry.');
  }
  const codeVerifier = cookies.x_oauth_verifier;
  if (!codeVerifier) {
    return res.status(400).send('Missing PKCE verifier cookie');
  }

  if (!clientId || !redirectUri) {
    return res.status(500).send('X OAuth not configured');
  }

  try {
    // 1. Exchange code for token
    const tokenBody = new URLSearchParams({
      code: String(code),
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    if (clientSecret) {
      tokenBody.set('client_secret', clientSecret);
    }

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('X token exchange failed:', t);
      return res.status(502).send('Token exchange failed: ' + t);
    }
    const token = await tokenRes.json();
    const accessToken = token.access_token;

    // 2. Fetch user info
    const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      const t = await userRes.text();
      console.error('X user fetch failed:', t);
      return res.status(502).send('Failed to fetch X user');
    }
    const { data: user } = await userRes.json();

    // 3. Encode and redirect
    const payload = {
      id: user.id,
      name: user.name,
      username: user.username,
      profile_image_url: user.profile_image_url,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

    // Clear cookies
    res.setHeader('Set-Cookie', [
      'x_oauth_verifier=; Path=/; HttpOnly; Max-Age=0',
      'x_oauth_state=; Path=/; HttpOnly; Max-Age=0',
    ]);

    res.redirect(302, `${baseUrl}/#x=${encoded}`);
  } catch (e) {
    console.error('X callback error:', e);
    res.status(500).send('OAuth flow failed');
  }
}
