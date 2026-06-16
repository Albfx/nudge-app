// api/analyze.js
// The gated AI call. Order of checks:
//   1. Who is this user? (verify their Supabase token)
//   2. Are they allowed? (paid & not expired, OR free analyses left)
//   3. Is the image actually a conversation/profile? (Claude validates)
//   4. Only then return real analysis.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FREE_LIMIT = 3;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // --- 1. Identify the user from their bearer token ---
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Please sign in first." });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    const user = userData.user;

    // --- 2. Check access ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, access_until, free_used")
      .eq("id", user.id)
      .single();

    const now = Date.now();
    const paidActive =
      profile?.access_until && new Date(profile.access_until).getTime() > now;
    const freeLeft = Math.max(0, FREE_LIMIT - (profile?.free_used || 0));

    if (!paidActive && freeLeft <= 0) {
      return res.status(402).json({
        error: "no_access",
        message: "You've used your 3 free analyses. Upgrade to keep going.",
      });
    }

    // --- 3 + 4. Validate + analyze with Claude ---
    const { imageBase64, mediaType, mode, gender, notes } = req.body || {};
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ error: "Missing image data." });
    }

    const isProfile = mode === "profile";
    const instruction = isProfile
      ? `You are a dating profile reviewer. You will receive ONE image.
STEP 1 — VALIDATE: is it really a dating-app PROFILE screenshot (photos and/or bio)?
A random photo, meme, landscape, or non-profile screenshot is INVALID.
STEP 2 — Only if valid, review it.
Respond with ONLY JSON, no markdown:
{"valid":true|false,"reason":"<if invalid, what to upload instead>","score":<0-10>,
"photo_feedback":["GOOD: ...","IMPROVE: ..."],"bio_feedback":["GOOD: ...","IMPROVE: ..."],
"improvements":["...","...","..."]}
${notes ? "Focus on: " + notes : ""}`
      : `You are a dating conversation coach. You will receive an image.
STEP 1 — VALIDATE: does it really show a TEXT CONVERSATION (chat bubbles between two people)?
A random photo, meme, landscape, selfie, or non-chat screenshot is INVALID.
STEP 2 — Only if valid, analyze it. The user is a ${gender || "person"}.
Respond with ONLY JSON, no markdown:
{"valid":true|false,"reason":"<if invalid, what to upload instead>",
"feedback":["GOOD: ...","IMPROVE: ..."],
"suggestions":[{"label":"Playful","text":"..."},{"label":"Move it forward","text":"..."},{"label":"Build connection","text":"..."}],
"interest_level":<0-100>,"mood_emoji":"<emoji>","mood_label":"<2-4 words>",
"state_of_mind":"<2-3 sentences>"}
Base everything ONLY on what is visible. ${notes ? "Note: " + notes : ""}`;

    const claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: instruction },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      return res.status(502).json({ error: "AI request failed", detail });
    }

    const data = await claudeRes.json();
    let text = (data.content || []).map((b) => b.text || "").join("").trim();
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Could not parse AI response", raw: text }); }

    // If the image was invalid, DO NOT consume a free analysis.
    if (parsed.valid === false) {
      return res.status(200).json(parsed);
    }

    // Valid analysis: if on free tier, increment their used count.
    if (!paidActive) {
      await supabase
        .from("profiles")
        .update({ free_used: (profile?.free_used || 0) + 1 })
        .eq("id", user.id);
      parsed._free_left = Math.max(0, freeLeft - 1);
    } else {
      parsed._paid_until = profile.access_until;
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
