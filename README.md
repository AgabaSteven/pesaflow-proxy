# D Gateway Proxy — your own payment backend

This is the secure backend for the **D Gateway Commerce** Framer components. You
host your own copy so that **your** D Gateway secret key never touches the
browser, and your orders stay in **your** account. It takes about 5 minutes.

It exposes four endpoints:

| Endpoint | Method | What it does |
|---|---|---|
| `/api/collect` | POST | Starts a mobile-money collection (MTN / Airtel via D Gateway). |
| `/api/verify`  | POST | Checks a payment's status by reference (the cart polls this). |
| `/api/webhook` | POST | Receives D Gateway payment events (HMAC-verified + re-confirmed). |
| `/api/order`   | GET  | Looks up an order by `?ref=` or `?phone=` (cross-device). |

Your secret API key lives only in this server's environment variables — it is
**never** shipped to the storefront.

---

## 1. Deploy it (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/AgabaSteven/dgateway-proxy-template&env=DGATEWAY_API_KEY,DGATEWAY_WEBHOOK_SECRET,ALLOWED_ORIGIN&envDescription=Your%20D%20Gateway%20API%20key%20%2B%20Webhook%20Secret%20(from%20the%20D%20Gateway%20dashboard%20Settings).&project-name=dgateway-proxy&repository-name=dgateway-proxy)

> The button clones this repo into the buyer's own Vercel account, so their
> deployment is fully isolated with their own keys.

When you click Deploy, Vercel asks for:

- **`DGATEWAY_API_KEY`** — your D Gateway secret API key
  (Dashboard → **Settings / API access**).
- **`DGATEWAY_WEBHOOK_SECRET`** — the Webhook Secret from the same Settings page.
- **`ALLOWED_ORIGIN`** *(optional)* — your published store URL, e.g.
  `https://yourstore.com`. Leave as `*` while testing.

Prefer the CLI instead? `npm install`, then `npx vercel deploy --prod`, and set
the same variables in the Vercel dashboard.

## 2. Add order storage (recommended)

So orders are saved for cross-device lookup (Order Tracker / the plugin's Orders
tab):

1. In your new Vercel project → **Storage** → **Create / Connect** an **Upstash
   Redis** (or KV) store.
2. Attach it to the project. Vercel injects `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically — no manual setup.
3. **Redeploy** so the functions pick them up.

> Payments still work without a store; you just won't have saved order history.

## 3. Point D Gateway's webhook at it

In your D Gateway **Dashboard → Settings**, set the **Webhook URL** to:

```
https://YOUR-PROJECT.vercel.app/api/webhook
```

Save. D Gateway will now notify your proxy on every payment, and the proxy
re-confirms each one against D Gateway before marking an order paid.

## 4. Connect your Framer store

In Framer, drop the **Commerce Config** component once and set **Pay Endpoint**
to your proxy's base URL:

```
https://YOUR-PROJECT.vercel.app
```

Every D Gateway Commerce component reads the endpoint from there — so you set it
in exactly one place.

---

## Security model

- **Secret key stays server-side.** The browser only ever talks to this proxy,
  never to D Gateway directly.
- **Webhooks are defence-in-depth:** the HMAC-SHA256 signature
  (`X-DGateway-Signature`) is verified against `DGATEWAY_WEBHOOK_SECRET`, **and**
  every event is independently re-confirmed via D Gateway's authenticated
  `/verify`. An order is marked `paid` only if D Gateway itself says so — a
  forged webhook cannot fake a payment.
- **Never commit secrets.** Keep them only in Vercel's Environment Variables.
  `.env` is gitignored; use `.env.example` as the template.

## Local development

```bash
npm install
cp .env.example .env   # fill in your keys
npx vercel dev         # runs the functions locally
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DGATEWAY_API_KEY is not configured` | Set the env var in Vercel, then redeploy. |
| Payments work but no order history | Attach an Upstash/KV store (step 2) and redeploy. |
| Webhook `signatureVerified: false` | `DGATEWAY_WEBHOOK_SECRET` doesn't match the dashboard value. |
| CORS errors in the browser | Set `ALLOWED_ORIGIN` to your store's URL (or `*` to test). |
