import { ok, err } from "../lib/http.js";
import { verifyAdminToken } from "../lib/auth.js";
import { getItem, putItem, updateItem, keys } from "../lib/ddb.js";
import { analyzeSubmission } from "../lib/claude.js";
import { assertClean } from "../lib/compliance.js";

/**
 * On-demand Claude analysis of a submission. Stores the result under the
 * submission's pk so history is preserved; also updates the submission's
 * score columns so the admin queue reflects the latest view.
 *
 * Rate limiting is not implemented yet — one call = one Claude request.
 * Admin-only endpoint so the exposure is small.
 */
export async function handler(event) {
    const admin = await verifyAdminToken(event.headers?.["x-housebrief-token"] || event.headers?.["X-HouseBrief-Token"]);
    if (!admin) return err("unauthorized", 401);

    const id = event.pathParameters?.id;
    if (!id) return err("id required");

    const submission = await getItem(keys.submission(id));
    if (!submission) return err("not found", 404);

    let analysis;
    try {
        analysis = await analyzeSubmission(submission);
    } catch (e) {
        return err(`Analysis failed: ${e.message}`, 502);
    }

    // Scrub Claude's output against the compliance linter before storing.
    try {
        assertClean(analysis.summary, "analysis.summary");
        for (const r of analysis.risks || []) assertClean(r, "analysis.risks[]");
        for (const f of analysis.suggestedFollowUps || []) {
            assertClean(f.prompt || "", "analysis.suggestedFollowUps.prompt");
        }
    } catch (e) {
        return err(`Claude returned forbidden language: ${e.message}`, 502);
    }

    const now = new Date().toISOString();
    await putItem({
        ...keys.analysis(id, now),
        submissionId: id,
        createdAt: now,
        createdByRole: admin.role,
        createdByName: admin.name,
        ...analysis,
    });

    // Roll up scores onto the submission for easy queue sorting.
    const urgency = Math.max(0, Math.min(5, Number(analysis.urgencyScore) || 0));
    await updateItem(keys.submission(id), {
        motivationScore: Number(analysis.motivationScore) || 0,
        complexityScore: Number(analysis.complexityScore) || 0,
        urgencyScore: urgency,
        confidenceScore: Number(analysis.confidenceScore) || 0,
        flags: analysis.flags || [],
        recommendation: analysis.recommendation || "review",
        updatedAt: now,
        gsi1sk: `${String(urgency).padStart(2, "0")}#${submission.createdAt}`,
    });

    return ok({ analysis });
}
