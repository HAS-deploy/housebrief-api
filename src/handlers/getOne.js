import { ok, err } from "../lib/http.js";
import { verifyUserToken } from "../lib/auth.js";
import { getItem, keys } from "../lib/ddb.js";

export async function handler(event) {
    const user = verifyUserToken(event.headers?.authorization || event.headers?.Authorization);
    if (!user) return err("unauthorized", 401);

    const id = event.pathParameters?.id;
    if (!id) return err("id required");

    const submission = await getItem(keys.submission(id));
    if (!submission) return err("not found", 404);
    if (submission.userId !== user.userId) return err("forbidden", 403);

    // Strip internal-only fields before returning to the seller.
    const { gsi1pk, gsi1sk, stage, ...sellerView } = submission;
    return ok({ submission: sellerView });
}
