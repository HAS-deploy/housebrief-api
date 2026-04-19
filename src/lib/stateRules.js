/**
 * Mirror of the iOS StateRulesEngine. Server is authoritative — client has
 * this as a fallback for offline mode. Compliance can edit these via admin
 * tooling later; for now they ship compiled in.
 */
export const UNIVERSAL_DISCLOSURES = [
    "We are a private home-buying company (principal buyer). We are not a real estate broker, agent, or representative.",
    "Submitting does not guarantee an offer.",
    "Any offer comes from our affiliated acquisition entity as a direct buyer.",
    "If we enter a contract, we may close ourselves or assign our contract rights where lawful.",
    "Availability depends on your property, market conditions, title review, and state eligibility.",
];

const RULES = {
    TX: { availability: "enabled", assignmentSensitivity: "low",    manualLegalReview: false },
    TN: { availability: "enabled", assignmentSensitivity: "low",    manualLegalReview: false },
    OH: { availability: "enabled", assignmentSensitivity: "medium", manualLegalReview: false },
    MO: { availability: "enabled", assignmentSensitivity: "low",    manualLegalReview: false },
    IN: { availability: "enabled", assignmentSensitivity: "low",    manualLegalReview: false },
};

export function rule(stateCode) {
    const code = (stateCode || "").toUpperCase();
    return RULES[code] ?? {
        availability: "blocked",
        assignmentSensitivity: "high",
        manualLegalReview: true,
    };
}

export function canSubmit(stateCode) {
    return rule(stateCode).availability !== "blocked";
}

export function disclosuresFor(stateCode) {
    return [...UNIVERSAL_DISCLOSURES];
}
