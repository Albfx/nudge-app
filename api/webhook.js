// api/webhook.js
// Stripe calls THIS when something happens (payment succeeded, subscription
// renewed, subscription cancelled). This is the only place that grants or
// revokes paid access — never trust the browser to say "I paid".

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Service-role key = full DB access. Server-only. NEVER put this in the browser.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel must NOT pre-parse the body — Stripe needs the raw bytes to verify.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Helper: set a user's plan + expiry in the database.
async function grantAccess(userId, plan, accessUntil, customerId) {
  await supabase
    .from("profiles")
    .update({
      plan,
      access_until: accessUntil,            // ISO string or null
      stripe_customer_id: customerId || null,
    })
    .eq("id", userId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const userId = s.client_reference_id || s.metadata?.userId;
      const plan = s.metadata?.plan;
      const customerId = s.customer;

      if (plan === "daypass") {
        // One-time payment: unlock for exactly 24 hours from now.
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await grantAccess(userId, "daypass", until, customerId);
      }
      // For subscriptions, we handle the dated access in the invoice event below,
      // but grant immediately here too so there's no gap.
      if (plan === "monthly" || plan === "yearly") {
        const days = plan === "yearly" ? 366 : 31;
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        await grantAccess(userId, plan, until, customerId);
      }
    }

    // Subscription renewed (or first payment) — extend access to period end.
    if (event.type === "invoice.paid") {
      const inv = event.data.object;
      const sub = inv.subscription
        ? await stripe.subscriptions.retrieve(inv.subscription)
        : null;
      if (sub) {
        const userId = sub.metadata?.userId;
        const plan = sub.metadata?.plan || "monthly";
        const until = new Date(sub.current_period_end * 1000).toISOString();
        await grantAccess(userId, plan, until, sub.customer);
      }
    }

    // Subscription cancelled or ended — revoke access.
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) await grantAccess(userId, "free", null, sub.customer);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: "Webhook handler failed", detail: String(err) });
  }
}
