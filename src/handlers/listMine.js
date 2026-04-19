import { ok, err } from "../lib/http.js";
import { verifyActiveUserToken } from "../lib/auth.js";
import { queryBegins } from "../lib/ddb.js";

export async function handler(event) {
    const user = await verifyActiveUserToken(event.headers?.authorization || event.headers?.Authorization);
    if (!user) return err("unauthorized", 401);

    const stubs = await queryBegins(`USER#${user.userId}`, "SUB#", { ascending: false, limit: 100 });
    return ok({
        submissions: stubs.map((s) => ({
            id: s.submissionId,
            status: s.status,
            stateCode: s.stateCode,
            addressShort: s.addressShort,
            createdAt: s.createdAt,
        })),
    });
}
