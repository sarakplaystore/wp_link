# Little Links

A Linktree-style profile with a password-protected admin editor. Published changes are shared with all visitors; they are stored in a database rather than in a browser or the serverless filesystem.

## Configure and deploy on Vercel

1. Import this repository into Vercel. Use the **Other** framework preset and the repository root. The `api` directory supplies Vercel serverless functions; do not deploy only the static files.
2. Connect a database: open the [Turso Cloud listing](https://vercel.com/marketplace/tursocloud) in the Vercel Marketplace, install it, and connect a database to this project. Vercel then adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the project for you; there is nothing to copy. The app creates its two small tables the first time it runs.
3. In the project's **Settings → Environment Variables**, add these for each environment you use:
   - `ADMIN_PASSWORD`: a long, unique admin password.
   - `SESSION_SECRET`: a separate random secret of at least 32 characters (e.g. output from `openssl rand -hex 32`).
4. Redeploy after connecting the database and setting the variables. Click **Admin**, sign in, and publish the profile, social URLs, and links. Replace the sample URLs before sharing. All deployments connected to the same database share a profile.

Until setup is complete, **Admin** opens a checklist that ticks off what is already in place and names what is still missing.

### Using Redis instead of Turso

Upstash Redis also works. Connect it from the Vercel Marketplace so that the project has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or set `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the Redis HTTPS REST URL and token (a complete KV pair takes precedence over the Upstash pair). If the Turso variables are also set, Turso is used. A profile is not copied from one database to another: publish it again after switching.

The public page displays the sample profile if the service is not configured or storage is unavailable; admin editing fails closed. The API returns non-cacheable responses. Admin sessions use signed, HTTP-only, same-site cookies and expire after eight hours. Login attempts are rate-limited per IP using the database. Changing `SESSION_SECRET` invalidates all existing sessions; sign-out clears the current browser's cookie. Keep both secrets private and use HTTPS in production.

## Local development

Node 20 or newer is required. For a disposable in-memory profile (lost on restart), run:

```sh
LOCAL_MEMORY_STORE=1 ADMIN_PASSWORD='your-local-password' SESSION_SECRET='a-local-secret-at-least-32-characters-long' npm run dev
```

Visit `http://localhost:3000`. Alternatively, supply the database variables above to test persistent storage. The in-memory store is disabled in production, and a database URL that starts with `http://` is accepted only outside production. Run tests with `npm test`.
