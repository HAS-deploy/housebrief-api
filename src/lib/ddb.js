import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const raw = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
});
export const TABLE = process.env.TABLE;

/**
 * Single-table layout:
 *   USER#<userId>                              (user profile)
 *     - sk = PROFILE                           → user
 *     - sk = SUB#<createdAt>#<submissionId>    → submission stub for listing
 *   SUB#<submissionId>                         (submission root + children)
 *     - sk = META                              → full submission
 *     - sk = ANALYSIS#<createdAt>              → Claude analysis result
 *     - sk = STATUS#<changedAt>                → status history
 *     - sk = NOTE#<createdAt>#<noteId>         → internal note
 *   ADMIN#QUEUE                                (admin queue GSI)
 *     gsi1pk = QUEUE#<stage>                   → all submissions by stage
 *     gsi1sk = <urgency>#<createdAt>           → sortable
 */
export const keys = {
    userProfile: (userId) => ({ pk: `USER#${userId}`, sk: "PROFILE" }),
    userSubmissionStub: (userId, createdAt, submissionId) => ({
        pk: `USER#${userId}`, sk: `SUB#${createdAt}#${submissionId}`,
    }),
    submission: (submissionId) => ({ pk: `SUB#${submissionId}`, sk: "META" }),
    analysis: (submissionId, createdAt) => ({
        pk: `SUB#${submissionId}`, sk: `ANALYSIS#${createdAt}`,
    }),
    statusHistory: (submissionId, changedAt) => ({
        pk: `SUB#${submissionId}`, sk: `STATUS#${changedAt}`,
    }),
    note: (submissionId, createdAt, noteId) => ({
        pk: `SUB#${submissionId}`, sk: `NOTE#${createdAt}#${noteId}`,
    }),
    queueGSI: (stage, urgency, createdAt) => ({
        gsi1pk: `QUEUE#${stage}`,
        gsi1sk: `${String(urgency).padStart(2, "0")}#${createdAt}`,
    }),
};

export async function getItem(k) {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: k }));
    return r.Item ?? null;
}

export async function putItem(item) {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
}

export async function updateItem(k, updates) {
    const names = {}, values = {}, sets = [];
    for (const [key, val] of Object.entries(updates)) {
        names[`#${key}`] = key;
        values[`:${key}`] = val;
        sets.push(`#${key} = :${key}`);
    }
    const r = await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: k,
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
    }));
    return r.Attributes;
}

export async function queryBegins(pk, skPrefix, opts = {}) {
    const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skp)",
        ExpressionAttributeValues: { ":pk": pk, ":skp": skPrefix },
        ScanIndexForward: opts.ascending ?? false,
        Limit: opts.limit ?? 100,
    }));
    return r.Items ?? [];
}

export async function queryGSI(gsi1pk, opts = {}) {
    const params = {
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :p",
        ExpressionAttributeValues: { ":p": gsi1pk },
        ScanIndexForward: opts.ascending ?? false,
        Limit: opts.limit ?? 100,
    };
    const r = await ddb.send(new QueryCommand(params));
    return r.Items ?? [];
}
