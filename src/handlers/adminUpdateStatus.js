import { ok, err, json } from "../lib/http.js";
import { verifyAdminToken } from "../lib/auth.js";
import { getItem, updateItem, putItem, keys } from "../lib/ddb.js";
import { assertClean } from "../lib/compliance.js";

const ALLOWED_STAGES = new Set(["new", "needs_review", "more_info", "qualified", "high_complexity",
    "legal_review", "acquisition_candidate", "passed", "contracted", "closed", "dead"]);
const ALLOWED_SELLER_STATUS = new Set(["submitted", "under_review", "need_more_info",
    "not_a_fit", "review_complete", "contact_requested"]);

export async function handler(event) {
    const admin = await verifyAdminToken(event.headers?.["x-housebrief-token"] || event.headers?.["X-HouseBrief-Token"]);
    if (!admin) return err("unauthorized", 401);

    const id = event.pathParameters?.id;
    if (!id) return err("id required");
    const body = json(event) || {};

    const submission = await getItem(keys.submission(id));
    if (!submission) return err("not found", 404);

    const now = new Date().toISOString();
    const updates = { updatedAt: now };
    let sellerVisibleChange = false;

    if (body.stage) {
        if (!ALLOWED_STAGES.has(body.stage)) return err("invalid stage");
        updates.stage = body.stage;
        // Keep GSI in sync
        const urgency = submission.urgencyScore ?? 0;
        updates.gsi1pk = `QUEUE#${body.stage}`;
        updates.gsi1sk = `${String(urgency).padStart(2, "0")}#${submission.createdAt}`;
    }

    if (body.sellerStatus) {
        if (!ALLOWED_SELLER_STATUS.has(body.sellerStatus)) return err("invalid sellerStatus");
        updates.status = body.sellerStatus;
        sellerVisibleChange = true;
    }

    if (typeof body.note === "string" && body.note.trim().length) {
        // Linter scrubs admin-authored notes before storage.
        assertClean(body.note, "admin note");
        const noteId = Math.random().toString(36).slice(2, 10);
        await putItem({
            ...keys.note(id, now, noteId),
            submissionId: id,
            authorRole: admin.role,
            authorName: admin.name,
            body: body.note,
            createdAt: now,
        });
    }

    await updateItem(keys.submission(id), updates);

    // Status history row for audit
    if (body.stage || body.sellerStatus) {
        await putItem({
            ...keys.statusHistory(id, now),
            submissionId: id,
            actorRole: admin.role,
            actorName: admin.name,
            fromStage: submission.stage,
            toStage: updates.stage ?? submission.stage,
            fromSellerStatus: submission.status,
            toSellerStatus: updates.status ?? submission.status,
            at: now,
        });
    }

    return ok({
        updated: true,
        sellerVisibleChange,
        submissionId: id,
        stage: updates.stage ?? submission.stage,
        sellerStatus: updates.status ?? submission.status,
    });
}
