import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ulid } from "ulid";
import { ok, err, json } from "../lib/http.js";
import { verifyUserToken } from "../lib/auth.js";
import { getItem, keys } from "../lib/ddb.js";

const s3 = new S3Client({});
const BUCKET = process.env.UPLOAD_BUCKET;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "application/pdf"]);
const MAX_BYTES = 15 * 1024 * 1024;

export async function handler(event) {
    const user = verifyUserToken(event.headers?.authorization || event.headers?.Authorization);
    if (!user) return err("unauthorized", 401);

    const id = event.pathParameters?.id;
    if (!id) return err("submission id required");

    const body = json(event) || {};
    const contentType = body.contentType;
    const sizeBytes = body.sizeBytes;

    if (!ALLOWED_TYPES.has(contentType)) return err("unsupported contentType");
    if (typeof sizeBytes !== "number" || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
        return err(`file must be 1 byte – ${MAX_BYTES} bytes`);
    }

    const submission = await getItem(keys.submission(id));
    if (!submission) return err("not found", 404);
    if (submission.userId !== user.userId) return err("forbidden", 403);

    const fileId = ulid();
    const ext = contentType === "application/pdf" ? "pdf"
        : contentType === "image/png" ? "png"
        : contentType === "image/heic" ? "heic" : "jpg";
    const key = `submissions/${id}/${fileId}.${ext}`;

    const cmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
        ContentLength: sizeBytes,
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });

    return ok({ uploadUrl, key, expiresInSec: 600 });
}
