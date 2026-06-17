// api/checkout.js
// Creates a Stripe Checkout session for the chosen plan and returns its URL.
// The browser sends the logged-in user's id + email and which plan they picked.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map our plan names to the Stripe Price IDs you create in the dashboard.
// daypass is a one-time payment; monthly/yearly are subscriptions.
const PLANS = {
  daypass: { price: process.env.STRIPE_PRICE_DAYPASS, mode: "payment" },
  monthly: { price: process.env.STRIPE_PRICE_MONTHLY, mode: "subscription" },
  yearly:  { price: process.env.STRIPE_PRICE_YEARLY,  mode: "subscription" },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { plan, userId, email, siteUrl } = req.body || {};
    const chosen = PLANS[plan];
    if (!chosen || !chosen.price) {
      return res.status(400).json({ error: "Unknown or unconfigured plan." });
    }
    if (!userId) {
      return res.status(400).json({ error: "You must be signed in to upgrade." });
    }

    const base = siteUrl || "https://example.com";

    const session = await stripe.checkout.sessions.create({
      mode: chosen.mode,
      line_items: [{ price: chosen.price, quantity: 1 }],
      customer_email: email,
      // We pass our own ids through so the webhook knows who paid and for what.
      client_reference_id: userId,
      metadata: { userId, plan },
      // For subscriptions, also stamp metadata on the subscription itself.
      subscription_data: chosen.mode === "subscription"
        ? { metadata: { userId, plan } }
        : undefined,
      success_url: `${base}?paid=success`,
      cancel_url: `${base}?paid=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: "Checkout failed", detail: String(err) });
  }
}
