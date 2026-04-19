import Anthropic from "@anthropic-ai/sdk";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let cachedKey = null;
const sm = new SecretsManagerClient({});

async function getKey() {
    if (cachedKey) return cachedKey;
    const r = await sm.send(new GetSecretValueCommand({
        SecretId: process.env.CLAUDE_SECRET_ID,
    }));
    const parsed = JSON.parse(r.SecretString);
    cachedKey = parsed.apiKey || parsed.key || parsed.ANTHROPIC_API_KEY;
    if (!cachedKey) throw new Error("No API key in Claude secret");
    return cachedKey;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, "..", "prompts", "analyze-submission.txt");
const SYSTEM_PROMPT = readFileSync(PROMPT_PATH, "utf8");

export async function analyzeSubmission(submission) {
    const apiKey = await getKey();
    const client = new Anthropic({ apiKey });

    const userPayload = {
        address: {
            line1: submission.addressLine1,
            city: submission.city,
            state: submission.stateCode,
            zip: submission.zip,
        },
        property: {
            type: submission.propertyType,
            yearBuilt: submission.yearBuilt,
            beds: submission.beds,
            baths: submission.baths,
            sqftEst: submission.sqftEst,
        },
        condition: {
            score: submission.conditionScore,
            notes: submission.repairNotes,
        },
        occupancy: submission.occupancy,
        timeline: submission.timeline,
        askingAmountCents: submission.askingAmountCents,
        situationFlags: {
            inherited: submission.flagInherited,
            probate: submission.flagProbate,
            behindOnPayments: submission.flagBehindOnPayments,
            taxOrLien: submission.flagTaxOrLien,
            codeViolation: submission.flagCodeViolation,
        },
        followUpAnswers: submission.followUpAnswers || [],
        photoCount: (submission.photos || []).length,
    };

    const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [
            { role: "user", content: JSON.stringify(userPayload) },
        ],
    });

    const text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("Claude response did not contain JSON");
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

    if (typeof parsed.motivationScore !== "number") throw new Error("bad motivationScore");
    if (typeof parsed.complexityScore !== "number") throw new Error("bad complexityScore");
    if (typeof parsed.urgencyScore !== "number") throw new Error("bad urgencyScore");
    if (typeof parsed.confidenceScore !== "number") throw new Error("bad confidenceScore");
    if (!Array.isArray(parsed.flags)) parsed.flags = [];
    if (!Array.isArray(parsed.suggestedFollowUps)) parsed.suggestedFollowUps = [];
    if (typeof parsed.summary !== "string") parsed.summary = "";
    if (typeof parsed.recommendation !== "string") parsed.recommendation = "review";

    return parsed;
}
