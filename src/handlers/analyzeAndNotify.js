import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { getItem, putItem, updateItem, keys } from "../lib/ddb.js";
import { analyzeSubmission } from "../lib/claude.js";
import { assertClean } from "../lib/compliance.js";

// Async worker fired by submit.js via Lambda.invoke(InvocationType=Event).
// Runs Claude analysis, stores results, updates submission scores (same
// shape as adminAnalyze does), then pushes an SNS notification to the
// owner with the summary + a link to the admin deal page.
//
// Event shape: { submissionId }
// No response body — invoked async, return value is ignored.

const sns = new SNSClient({});

export async function handler(event) {
    const submissionId = event?.submissionId;
    if (!submissionId) {
        console.error("[analyzeAndNotify] missing submissionId in event", event);
        return;
    }

    const submission = await getItem(keys.submission(submissionId));
    if (!submission) {
        console.warn(`[analyzeAndNotify] submission ${submissionId} not found — likely deleted between submit and worker fire`);
        return;
    }

    let analysis;
    try {
        analysis = await analyzeSubmission(submission);
    } catch (e) {
        console.error(`[analyzeAndNotify] Claude failed for ${submissionId}:`, e.message);
        // Still notify, but with a degraded body — owner should still know a
        // submission came in even if analysis crashed.
        await publishFallback(submission, e.message);
        return;
    }

    // Same compliance scrub adminAnalyze does before storing.
    try {
        assertClean(analysis.summary, "analysis.summary");
        for (const r of analysis.risks || []) assertClean(r, "analysis.risks[]");
        for (const f of analysis.suggestedFollowUps || []) {
            assertClean(f.prompt || "", "analysis.suggestedFollowUps.prompt");
        }
    } catch (e) {
        console.error(`[analyzeAndNotify] Claude returned forbidden language for ${submissionId}: ${e.message}`);
        await publishFallback(submission, `compliance scrub failed: ${e.message}`);
        return;
    }

    const now = new Date().toISOString();
    await putItem({
        ...keys.analysis(submissionId, now),
        submissionId,
        createdAt: now,
        createdByRole: "system",
        createdByName: "auto-on-submit",
        ...analysis,
    });

    const urgency = Math.max(0, Math.min(5, Number(analysis.urgencyScore) || 0));
    await updateItem(keys.submission(submissionId), {
        motivationScore: Number(analysis.motivationScore) || 0,
        complexityScore: Number(analysis.complexityScore) || 0,
        urgencyScore: urgency,
        confidenceScore: Number(analysis.confidenceScore) || 0,
        flags: analysis.flags || [],
        recommendation: analysis.recommendation || "review",
        updatedAt: now,
        gsi1sk: `${String(urgency).padStart(2, "0")}#${submission.createdAt}`,
    });

    await publishAnalysis(submission, analysis);
}

function formatAddress(s) {
    const parts = [s.addressLine1];
    if (s.addressLine2) parts.push(s.addressLine2);
    parts.push(`${s.city}, ${s.stateCode} ${s.zip}`);
    return parts.join(", ");
}

function formatAsking(cents) {
    if (cents == null) return "(not provided)";
    return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function publishAnalysis(submission, analysis) {
    const adminBase = process.env.ADMIN_BASE_URL || "";
    const link = adminBase
        ? `${adminBase.replace(/\/$/, "")}/submissions?focus=${submission.submissionId}`
        : `(set ADMIN_BASE_URL to enable direct link) submissionId=${submission.submissionId}`;

    const flagList = (analysis.flags || []).join(", ") || "(none)";
    const followUps = (analysis.suggestedFollowUps || [])
        .map((f, i) => `  ${i + 1}. ${f.prompt || f}`)
        .join("\n") || "  (none)";

    const body = [
        `NEW HOUSEBRIEF SUBMISSION`,
        ``,
        `Address:  ${formatAddress(submission)}`,
        `Type:     ${submission.propertyType || "single_family"}`,
        `Asking:   ${formatAsking(submission.askingAmountCents)}`,
        `Timeline: ${submission.timeline}`,
        `Occupancy: ${submission.occupancy}`,
        ``,
        `── CLAUDE ANALYSIS ──`,
        `Recommendation: ${analysis.recommendation || "review"}`,
        `Scores — Motivation ${analysis.motivationScore}/5 · Urgency ${analysis.urgencyScore}/5 · Complexity ${analysis.complexityScore}/5 · Confidence ${analysis.confidenceScore}/5`,
        `Flags: ${flagList}`,
        ``,
        `Summary:`,
        analysis.summary || "(no summary)",
        ``,
        `Suggested follow-ups:`,
        followUps,
        ``,
        `── ADMIN LINK ──`,
        link,
    ].join("\n");

    await sns.send(new PublishCommand({
        TopicArn: process.env.SNS_TOPIC_ARN,
        Subject: `HouseBrief · ${submission.stateCode} · ${submission.city} (urgency ${analysis.urgencyScore}/5)`.slice(0, 100),
        Message: body,
    }));
}

async function publishFallback(submission, errMsg) {
    const adminBase = process.env.ADMIN_BASE_URL || "";
    const link = adminBase
        ? `${adminBase.replace(/\/$/, "")}/submissions?focus=${submission.submissionId}`
        : `submissionId=${submission.submissionId}`;
    await sns.send(new PublishCommand({
        TopicArn: process.env.SNS_TOPIC_ARN,
        Subject: `HouseBrief · new submission (analysis failed)`,
        Message: [
            `A new submission came in but automatic analysis failed.`,
            ``,
            `Address: ${formatAddress(submission)}`,
            `Error:   ${errMsg}`,
            ``,
            `Re-run analysis manually from the admin UI:`,
            link,
        ].join("\n"),
    }));
}
