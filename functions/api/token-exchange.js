// Cloudflare Pages Function — proxies OAuth token exchange for providers
// that require a client_secret (pCloud, Box). Dropbox uses PKCE and
// exchanges directly from the browser, so it doesn't hit this endpoint.

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { provider, code, redirect_uri, code_verifier, refresh_token, grant_type } = body;

  const configs = {
    pcloud: {
      tokenUrl: "https://api.pcloud.com/oauth2_token",
      clientId: env.PCLOUD_CLIENT_ID,
      clientSecret: env.PCLOUD_CLIENT_SECRET,
    },
    box: {
      tokenUrl: "https://api.box.com/oauth2/token",
      clientId: env.BOX_CLIENT_ID,
      clientSecret: env.BOX_CLIENT_SECRET,
    },
  };

  const config = configs[provider];
  if (!config) {
    return new Response(JSON.stringify({ error: "Unknown provider" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const params = new URLSearchParams();
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);

  if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return new Response(JSON.stringify({ error: "Missing refresh_token" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", refresh_token);
  } else {
    // Default to authorization_code
    if (!code) {
      return new Response(JSON.stringify({ error: "Missing code" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("redirect_uri", redirect_uri);
    if (code_verifier) params.set("code_verifier", code_verifier);
  }

  const resp = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await resp.json();

  return new Response(JSON.stringify(data), {
    status: resp.ok ? 200 : 400,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://staktrakr.com",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "https://staktrakr.com",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
