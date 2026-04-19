import { ok, err } from "../lib/http.js";
import { verifyAdminToken } from "../lib/auth.js";
import { getItem, queryBegins, keys } from "../lib/ddb.js";

export async function handler(event) {
    const admin = await verifyAdminToken(event.headers?.["x-housebrief-token"] || event.headers?.["X-HouseBrief-Token"]);
    if (!admin) return err("unauthorized", 401);

    const id = event.pathParameters?.id;
    if (!id) return err("id required");

    const submission = await getItem(keys.submission(id));
    if (!submission) return err("not found", 404);

    const related = await queryBegins(`SUB#${id}`, "", { ascending: true, limit: 200 });
    const analyses = related.filter((x) => x.sk.startsWith("ANALYSIS#"));
    const statusHistory = related.filter((x) => x.sk.startsWith("STATUS#"));
    const notes = related.filter((x) => x.sk.startsWith("NOTE#"));

    // Pull seller contact (profile) — admins need it to call/email.
    const profile = await getItem(keys.userProfile(submission.userId));

    return ok({
        actor: { role: admin.role, name: admin.name },
        submission,
        seller: profile ? {
            userId: profile.userId,
            email: profile.email,
            phone: profile.phone,
            deletedAt: profile.deletedAt || null,
        } : null,
        analyses,
        statusHistory,
        notes,
    });
}
