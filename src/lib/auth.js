import crypto from "node:crypto";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { getItem, putItem, keys } from "./ddb.js";

const sm = new SecretsManagerClient({});
let cachedAdminTokens = null;

/**
 * Consumer auth: stateless shared-secret with user-scoped token.
 * Format: `user_<userId>_<hmac(userId, appSecret)>`.
 * Good enough for v1 + simple client. Swap for Cognito or Clerk when
 * we need SMS OTP and SIWA-aligned flows.
 */
function userSecret() {
    // pulled once per cold start; rotate via Secrets Manager
    return process.env.USER_TOKEN_SECRET || "dev-unsafe-rotate-me";
}

export function issueUserToken(userId) {
    const mac = crypto.createHmac("sha256", userSecret()).update(userId).digest("hex").slice(0, 32);
    return `user_${userId}_${mac}`;
}

export function verifyUserToken(authHeader) {
    const t = (authHeader || "").replace(/^Bearer\s+/i, "");
    const m = /^user_([0-9A-Z]+)_([a-f0-9]{32})$/.exec(t);
    if (!m) return null;
    const [, userId, mac] = m;
    const expected = crypto.createHmac("sha256", userSecret()).update(userId).digest("hex").slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    return { userId };
}

/**
 * Stronger check: HMAC-verify the token AND confirm the user profile still
 * exists and hasn't been deleted. Use this on any endpoint that should
 * reject tokens from deleted accounts (list-mine, get-one, upload-url,
 * delete-account — i.e., everything token-gated except the open submit
 * endpoint).
 */
export async function verifyActiveUserToken(authHeader) {
    const basic = verifyUserToken(authHeader);
    if (!basic) return null;
    const profile = await getItem(keys.userProfile(basic.userId));
    if (!profile || profile.deletedAt) return null;
    return { userId: basic.userId, profile };
}

/**
 * Admin auth: long random tokens stored in Secrets Manager as a JSON map
 * { "<token>": { "role": "acquisitions|compliance|admin|dispo", "name": "..." } }
 * Simple, rotatable without a deploy. For 1–5 admin users this is plenty.
 */
async function loadAdminTokens() {
    if (cachedAdminTokens) return cachedAdminTokens;
    try {
        const r = await sm.send(new GetSecretValueCommand({
            SecretId: process.env.ADMIN_TOKENS_SECRET_ID,
        }));
        cachedAdminTokens = JSON.parse(r.SecretString || "{}");
    } catch {
        cachedAdminTokens = {};
    }
    return cachedAdminTokens;
}

export async function verifyAdminToken(headerValue) {
    const tokens = await loadAdminTokens();
    const t = (headerValue || "").trim();
    if (!t || !tokens[t]) return null;
    return tokens[t]; // { role, name }
}

/**
 * Lightweight "seller sign-up" — a user submits email + phone and we mint
 * a userId + token. Real OTP / SIWA ships later; for v1 this is good enough
 * to attach submissions to a stable identity.
 */
export async function signInOrSignUp({ email, phone }) {
    const key = `lookup:${(email || "").toLowerCase()}`;
    let existing = await getItem({ pk: key, sk: "LOOKUP" });
    if (existing?.userId) {
        return { userId: existing.userId, token: issueUserToken(existing.userId) };
    }
    const userId = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const now = new Date().toISOString();
    await putItem({ pk: key, sk: "LOOKUP", userId, createdAt: now });
    await putItem({
        ...keys.userProfile(userId),
        userId, email: email || null, phone: phone || null, createdAt: now,
    });
    return { userId, token: issueUserToken(userId) };
}
