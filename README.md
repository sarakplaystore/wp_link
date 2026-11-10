# Little Links

A Linktree-style profile with a password-protected admin editor. Published changes are shared with all visitors; they are stored in Redis rather than in a browser or the serverless filesystem.

## Configure and deploy on Vercel

1. Import this repository into Vercel. Use the **Other** framework preset and the repository root. The `api` directory supplies Vercel serverless functions; do not deploy only the static files.
2. Provision an Upstash Redis database (for example through the Vercel Marketplace) with its REST API enabled. Set these environment variables for each Vercel environment you use:
   - `KV_REST_API_URL`: the Redis REST URL (HTTPS).
   - `KV_REST_API_TOKEN`: its REST token.
   - `ADMIN_PASSWORD`: a long, unique admin password.
   - `SESSION_SECRET`: a separate random secret of at least 32 characters (e.g. output from `openssl rand -hex 32`).
3. Redeploy after setting the variables. Click **Admin**, sign in, and publish the profile, social URLs, and links. Replace the sample URLs before sharing. All deployments configured against the same Redis database share a profile.

The public page displays the sample profile if the service is not configured or storage is unavailable; admin editing fails closed. The API returns non-cacheable responses. Admin sessions use signed, HTTP-only, same-site cookies and expire after eight hours. Login attempts are rate-limited per IP using Redis. Changing `SESSION_SECRET` invalidates all existing sessions; sign-out clears the current browser's cookie. Keep both secrets private and use HTTPS in production.

## Local development

Node 20 or newer is required. For a disposable in-memory profile (lost on restart), run:

```sh
LOCAL_MEMORY_STORE=1 ADMIN_PASSWORD='your-local-password' SESSION_SECRET='a-local-secret-at-least-32-characters-long' npm run dev
```

Visit `http://localhost:3000`. Alternatively, supply the Redis variables above to test persistent storage. The in-memory store is disabled in production. Run tests with `npm test`.
