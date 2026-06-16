# Nudge — Full Setup (accounts + payments + 24h access)

This turns the demo into a real product: people sign in, pay, and get access
that the system actually enforces. The day pass really does expire 24h after purchase.

You'll touch three free services: **Supabase** (accounts + database),
**Stripe** (payments), **Vercel** (hosting the backend + site).

I can't log into these for you or handle your secret keys — you'll paste them
into each dashboard yourself. Follow in order; it takes about 30–45 minutes.

---

## Part 1 — Supabase (accounts + database)

1. Go to https://supabase.com → sign up → "New project". Pick any name + password.
2. When it's ready, open **SQL Editor** → "New query".
3. Open `schema.sql` from this folder, paste the whole thing, click **Run**.
   This creates the `profiles` table and auto-creates a profile when someone signs up.
4. Go to **Project Settings → API**. Copy these two (you'll need them twice):
   - **Project URL** (like `https://abcd.supabase.co`)
   - **anon public** key (safe for the browser)
   - **service_role** key (SECRET — backend only, never in the browser)
5. Go to **Authentication → Providers → Email**. Make sure "Email" is enabled.
   (Magic-link sign-in is on by default.)

---

## Part 2 — Stripe (payments)

1. Go to https://stripe.com → sign up. Stay in **Test mode** (toggle, top right) for now.
2. Go to **Products → Add product**, create three:
   - **Day Pass** — one-time price **$2.99** → copy its Price ID (`price_...`)
   - **Monthly** — recurring **$4.99 / month** → copy its Price ID
   - **Yearly** — recurring **$39 / year** → copy its Price ID
3. Go to **Developers → API keys**. Copy your **Secret key** (`sk_test_...`).
4. The webhook secret comes later (Part 3, step 5).

---

## Part 3 — Vercel (backend + site)

1. Put this whole `nudge-app` folder on GitHub (new repo, upload files).
2. Go to https://vercel.com → sign in with GitHub → "Add New Project" → pick the repo → Deploy.
3. After it deploys, copy your site URL (like `https://nudge-app.vercel.app`).
4. Go to **Project → Settings → Environment Variables** and add all of these:

   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | your `sk-ant-...` Claude key |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key (secret) |
   | `STRIPE_SECRET_KEY` | Stripe `sk_test_...` |
   | `STRIPE_PRICE_DAYPASS` | Day Pass price ID |
   | `STRIPE_PRICE_MONTHLY` | Monthly price ID |
   | `STRIPE_PRICE_YEARLY` | Yearly price ID |
   | `STRIPE_WEBHOOK_SECRET` | (fill after step 5) |

5. Set up the webhook so Stripe can tell your app about payments:
   - In Stripe: **Developers → Webhooks → Add endpoint**.
   - Endpoint URL: `https://YOUR-SITE.vercel.app/api/webhook`
   - Events to send: `checkout.session.completed`, `invoice.paid`,
     `customer.subscription.deleted`
   - Create it, then copy the **Signing secret** (`whsec_...`).
   - Back in Vercel, set `STRIPE_WEBHOOK_SECRET` to that value.
6. **Redeploy** (Deployments → ⋯ → Redeploy) so all env vars take effect.

---

## Part 4 — Connect the frontend

Open `index.html` and fill in the three values near the top of the `<script>`:

```js
const BACKEND_URL  = "https://YOUR-SITE.vercel.app";
const SUPABASE_URL = "https://abcd.supabase.co";
const SUPABASE_ANON_KEY = "your anon public key";
```

`index.html` is served by the same Vercel deploy, so your live site is just
`https://YOUR-SITE.vercel.app`. Commit the change and it redeploys automatically.

---

## Part 5 — Test it (in Stripe test mode)

1. Open your live site, click **Sign in**, enter your email, click the magic link.
2. Go to **Pricing → Get Day Pass**. You'll land on Stripe Checkout.
3. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC.
4. After paying you return to the site. Now run an analysis — it should work.
5. Check Supabase → Table editor → `profiles`: your row should show
   `plan = daypass` and `access_until` set to ~24h ahead.
6. To prove expiry works: edit that `access_until` cell to a past time, then
   try another analysis — it should refuse and point you to Pricing.

When everything works in test mode, switch Stripe to **Live mode**, redo the
products + keys with live values, and update the Vercel env vars. Then real
cards charge for real.

---

## How the 24-hour pass actually works

- Buying the day pass triggers `checkout.session.completed` → the webhook writes
  `access_until = now + 24h` into your database.
- Every analysis call checks `access_until` on the server. Past it → refused.
- Nothing in the browser can fake this; the check lives in `api/analyze.js`.

## Security reminders
- The **service_role** key and **Stripe secret key** live ONLY in Vercel env vars.
  Never paste them into `index.html`.
- Once your real domain is live, change `Access-Control-Allow-Origin: "*"` in the
  three `api/*.js` files to your domain so others can't call your backend.
