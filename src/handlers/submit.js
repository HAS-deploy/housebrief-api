import { ulid } from "ulid";
import { ok, err, json } from "../lib/http.js";
import { verifyUserToken, signInOrSignUp } from "../lib/auth.js";
import { putItem, keys } from "../lib/ddb.js";
import { canSubmit, rule } from "../lib/stateRules.js";

export async function handler(event) {
    const body = json(event);
    if (!body) return err("invalid JSON body");

    // If no token, allow the submit to auto-sign-up. Real v2 will gate this
    // behind OTP / SIWA — for v1 we accept email+phone as identity.
    let user = verifyUserToken(event.headers?.authorization || event.headers?.Authorization);
    let issuedToken = null;
    if (!user) {
        if (!body.contactEmail) return err("contactEmail required for first submission");
        const signed = await signInOrSignUp({
            email: body.contactEmail,
            phone: body.contactPhone,
        });
        user = { userId: signed.userId };
        issuedToken = signed.token;
    }

    // State gating — the single most important compliance check.
    const stateCode = (body.stateCode || "").toUpperCase();
    if (stateCode.length !== 2) return err("stateCode required (2-letter U.S. state)");
    if (!canSubmit(stateCode)) {
        return err(`Not accepting submissions from ${stateCode} at this time.`, 403);
    }

    // Basic address sanity. Deliberately light — we're not a broker, we're
    // not validating listings, we're just making sure the address is usable.
    for (const k of ["addressLine1", "city", "zip"]) {
        if (!body[k] || String(body[k]).trim().length === 0) {
            return err(`${k} required`);
        }
    }
    if (!/^\d{5}(-\d{4})?$/.test(body.zip)) return err("zip must be a 5-digit U.S. ZIP");

    const submissionId = ulid();
    const now = new Date().toISOString();
    const stateRule = rule(stateCode);

    const submission = {
        ...keys.submission(submissionId),
        submissionId,
        userId: user.userId,
        createdAt: now,
        updatedAt: now,
        status: "submitted",
        stage: "new",                // internal pipeline stage (admin surface)
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2 || "",
        city: body.city,
        stateCode,
        zip: body.zip,
        propertyType: body.propertyType || "single_family",
        yearBuilt: body.yearBuilt ?? null,
        beds: body.beds ?? null,
        baths: body.baths ?? null,
        sqftEst: body.sqftEst ?? null,
        conditionScore: body.conditionScore ?? 3,
        repairNotes: body.repairNotes || "",
        occupancy: body.occupancy || "unknown",
        timeline: body.timeline || "flexible",
        askingAmountCents: body.askingAmountCents ?? null,
        flagInherited: !!body.flagInherited,
        flagProbate: !!body.flagProbate,
        flagBehindOnPayments: !!body.flagBehindOnPayments,
        flagTaxOrLien: !!body.flagTaxOrLien,
        flagCodeViolation: !!body.flagCodeViolation,
        motivationScore: 0,
        complexityScore: 0,
        urgencyScore: 0,
        confidenceScore: 0,
        stateRuleSnapshot: stateRule,
        // GSI for admin queue
        gsi1pk: `QUEUE#new`,
        gsi1sk: `00#${now}`,
    };
    await putItem(submission);

    // Stub record on the user's list for fast "my submissions" query.
    await putItem({
        ...keys.userSubmissionStub(user.userId, now, submissionId),
        submissionId, status: "submitted", stateCode,
        addressShort: `${body.addressLine1}, ${body.city} ${stateCode}`,
        createdAt: now,
    });

    return ok({
        submissionId,
        status: "submitted",
        token: issuedToken,          // present only on first-ever submission
        userId: user.userId,
    }, 201);
}
