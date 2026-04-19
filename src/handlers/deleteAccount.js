import { ok, err } from "../lib/http.js";
import { verifyActiveUserToken } from "../lib/auth.js";
import { queryBegins, updateItem, keys } from "../lib/ddb.js";

/**
 * App Store 5.1.1(v): account deletion required. We anonymize rather than
 * hard-delete because submissions are part of our acquisition audit trail
 * and (where a contract was signed) may be legally-retainable records.
 *
 * After this runs, verifyActiveUserToken rejects the token on every
 * subsequent authed request — same token, but the profile now has
 * deletedAt set, so the check fails.
 */
export async function handler(event) {
    const user = await verifyActiveUserToken(event.headers?.authorization || event.headers?.Authorization);
    if (!user) return err("unauthorized", 401);

    const now = new Date().toISOString();
    await updateItem(keys.userProfile(user.userId), {
        email: null,
        phone: null,
        deletedAt: now,
    });

    // Strip PII off submission stubs so the user's list view is empty too.
    const stubs = await queryBegins(`USER#${user.userId}`, "SUB#", { limit: 200 });
    for (const s of stubs) {
        await updateItem({ pk: s.pk, sk: s.sk }, {
            addressShort: "(deleted)",
            deletedAt: now,
        });
    }

    return ok({ deleted: true });
}
