import { ok, err } from "../lib/http.js";
import { verifyAdminToken } from "../lib/auth.js";
import { queryGSI } from "../lib/ddb.js";

const STAGES = new Set(["new", "needs_review", "more_info", "qualified", "high_complexity",
    "legal_review", "acquisition_candidate", "passed", "contracted", "closed", "dead"]);

export async function handler(event) {
    const admin = await verifyAdminToken(event.headers?.["x-housebrief-token"] || event.headers?.["X-HouseBrief-Token"]);
    if (!admin) return err("unauthorized", 401);

    const stage = event.queryStringParameters?.stage || "new";
    if (!STAGES.has(stage)) return err("unknown stage");

    const items = await queryGSI(`QUEUE#${stage}`, { ascending: false, limit: 100 });

    return ok({
        stage,
        actor: { role: admin.role, name: admin.name },
        count: items.length,
        submissions: items.map((s) => ({
            id: s.submissionId,
            userId: s.userId,
            status: s.status,
            stage: s.stage,
            stateCode: s.stateCode,
            city: s.city,
            addressLine1: s.addressLine1,
            zip: s.zip,
            motivationScore: s.motivationScore,
            complexityScore: s.complexityScore,
            urgencyScore: s.urgencyScore,
            confidenceScore: s.confidenceScore,
            flags: s.flags || [],
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        })),
    });
}
