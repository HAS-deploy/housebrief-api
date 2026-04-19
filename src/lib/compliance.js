/**
 * Server-side mirror of the iOS ComplianceLinter. Used to (a) scrub any
 * admin-authored follow-up message text before it's sent to sellers and
 * (b) sanity-check Claude's analysis output before it's stored.
 */
const FORBIDDEN = [
    "broker", "brokerage", "realtor", "agent", "agency",
    "licensee", "fiduciary", "representative", "intermediary",
    "listing", "listed", "mls",
    "guaranteed offer", "guaranteed cash", "instant offer", "instant cash",
    "top dollar", "best price",
    "we work for you", "your best interest", "on your behalf",
    "find you a buyer", "market your home", "list your home",
];

const NEGATIONS = [
    "not a ", "not an ", "not the ",
    "do not ", "don't ", "doesn't ", "never ",
    "we aren't ", "we are not ", "we're not ",
];

function isNegated(lower, matchStart) {
    const window = lower.slice(Math.max(0, matchStart - 60), matchStart);
    const lastTerm = Math.max(
        window.lastIndexOf("."),
        window.lastIndexOf("!"),
        window.lastIndexOf("?"),
    );
    const scan = lastTerm >= 0 ? window.slice(lastTerm + 1) : window;
    return NEGATIONS.some((n) => scan.includes(n));
}

export function check(text) {
    const out = [];
    const lower = (text || "").toLowerCase();
    for (const w of FORBIDDEN) {
        let i = 0;
        while ((i = lower.indexOf(w, i)) !== -1) {
            const before = i === 0 ? " " : lower[i - 1];
            const after = i + w.length >= lower.length ? " " : lower[i + w.length];
            const boundary = (c) => !/[a-z0-9]/.test(c);
            if (boundary(before) && boundary(after) && !isNegated(lower, i)) {
                out.push({ word: w, index: i });
            }
            i += w.length;
        }
    }
    return out;
}

export function assertClean(text, label = "text") {
    const findings = check(text);
    if (findings.length) {
        const err = new Error(`Compliance violation in ${label}: ${findings.map((f) => f.word).join(", ")}`);
        err.findings = findings;
        throw err;
    }
}
