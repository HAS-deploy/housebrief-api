# housebrief-api

Backend for HouseBrief — a free iOS app where U.S. homeowners submit a property to a private home-buying company for review. **Principal buyer. Not a broker.** All copy, state-rules, and output scrubbing is designed to keep HouseBrief on the principal-buyer side of state licensing lines.

## Shape

AWS Lambda + API Gateway (HTTP API) + DynamoDB (single-table) + S3 (photos/docs) + Anthropic Claude for deal analysis. Deploys via Serverless Framework.

No Postgres, no always-on servers, no Elasticsearch — intentionally lean. If volume outgrows DDB's query patterns, add OpenSearch or move to Aurora; v1 handles thousands of submissions without breaking a sweat.

## Endpoints

Consumer (token: `Authorization: Bearer user_<id>_<mac>`):
- `POST /v1/submissions` — create (auto-signs-up a new user on first submission)
- `GET  /v1/submissions/mine` — list
- `GET  /v1/submissions/{id}` — detail
- `POST /v1/submissions/{id}/upload-url` — presigned S3 URL for a photo/doc
- `POST /v1/state-check` — ZIP/state gating + disclosures
- `DELETE /v1/account` — 5.1.1(v) account deletion (anonymize)

Admin (token: `X-HouseBrief-Token: <admin-token>`):
- `GET   /admin/v1/queue?stage=new` — queue by stage
- `GET   /admin/v1/submissions/{id}` — full detail + history + seller PII
- `PATCH /admin/v1/submissions/{id}` — update stage / seller status / add internal note
- `POST  /admin/v1/submissions/{id}/analyze` — Claude analyzes the submission

## Claude analysis

`src/prompts/analyze-submission.txt` is the load-bearing prompt. Output is strict JSON: scores (motivation / complexity / urgency / confidence), flags, suggested follow-ups, risks, summary, recommendation. Every string is scrubbed through `src/lib/compliance.js` before storage — if Claude returns forbidden language, the call 502s and nothing is persisted. The same linter governs admin-authored notes.

## Secrets

- `housebrief/anthropic-api-key` — JSON: `{"apiKey": "sk-ant-..."}`
- `housebrief/admin-tokens` — JSON: `{"<long-random-token>": {"role": "admin", "name": "Tony"}}`

Create both in AWS Secrets Manager before first deploy.

## Deploy

```
npm install
npx serverless deploy --stage dev
# or
npx serverless deploy --stage prod
```

Writes an API URL output — feed that into the iOS app's `API_BASE_URL` and the admin dashboard's `NEXT_PUBLIC_API_BASE`.

## Compliance rules (non-negotiable)

- `src/lib/compliance.js` scrubs every Claude output and every admin note for forbidden language (broker, agent, realtor, guaranteed offer, market your home, etc.). Build fails tests / returns 502s if something slips.
- `src/lib/stateRules.js` gates submissions by U.S. state. Launch set: TX / TN / OH / MO / IN. All other states return 403 on submit.
- Status labels visible to the seller are acquisition-focused, never broker-like: `submitted / under_review / need_more_info / not_a_fit / review_complete / contact_requested`.

## NOT in this repo

- iOS app: `housebrief` repo
- Admin web dashboard: `housebrief-admin` repo (Next.js on Vercel)
- Legal counsel review of the seller terms + per-state disclosures — still a HARD prerequisite before accepting a real submission.
