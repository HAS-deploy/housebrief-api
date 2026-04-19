import { ok, err, json } from "../lib/http.js";
import { canSubmit, rule, disclosuresFor, UNIVERSAL_DISCLOSURES } from "../lib/stateRules.js";

export async function handler(event) {
    const body = json(event) || {};
    const code = (body.stateCode || "").toUpperCase();
    if (code.length !== 2) return err("stateCode required");
    const r = rule(code);
    return ok({
        stateCode: code,
        availability: r.availability,
        canSubmit: canSubmit(code),
        disclosures: disclosuresFor(code),
        universalDisclosures: UNIVERSAL_DISCLOSURES,
    });
}
