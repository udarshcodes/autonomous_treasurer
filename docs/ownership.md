# Who owns what

Each package has one owner. Change someone else's package through a PR they review. Every open piece of work is marked `TODO(<owner>)` in the code, so `git grep "TODO(AI 3)"` lists AI 3's remaining work.

| Person | Role | Packages and paths | Report features |
|---|---|---|---|
| Dev 1 | Platform and PayPal | `packages/db`, `packages/paypal`, `apps/api` (app shell, auth, webhooks, ledger routes), `apps/worker`, `render.yaml`, `packages/policy` execution path | C1 backend, infra |
| Dev 2 | Frontend | `apps/web` except `app/e/**` (workspace, AG Grid ledger, approval inbox, console UI, Bryntum timeline) | Treasurer workspace |
| AI 1 | Agent lead and integrator | `packages/llm`, `packages/agent` | Console, S1 |
| AI 2 | Document intelligence | `packages/documents`, `evals/receipts` | C2, C3 |
| AI 3 | Policy and safety | `packages/policy`, `policies/*.yaml`, `evals/injection` | C4, governance |
| AI 4 | Reconciliation and data | `packages/recon` (seed, matcher, statement), `evals/recon` | C6, S5, S4 |
| AI 5 | Comms, payouts and story | `packages/comms`, `apps/api/src/routes/{public,comms}.ts`, `apps/web/app/e/**`, `README.md`, `postman/`, `docs/demo-video.md`, `docs/submission.md` | C5, C1 nudges, submission |

## Contracts between packages

These are the seams. Changing one needs a heads-up to everyone who uses it.

| Contract | Defined in | Produced by | Consumed by |
|---|---|---|---|
| `SpendProposal`: anything that wants money to move | `packages/shared/src/proposal.ts` | agent `propose_*` tools (AI 1), receipts (AI 2), prizes (AI 5), refunds (AI 1) | policy engine (AI 3) |
| `PolicyDecision`: blocked / auto-approved / needs approval, with rule results and AI flags | `packages/shared/src/proposal.ts` | policy engine (AI 3) | approval explainer (AI 5), approval inbox (Dev 2) |
| `LlmClient.object()`: schema-validated LLM calls; `untrusted()` wrapper for outside text | `packages/llm` | AI 1 | every AI module |
| `custom_id` on orders: `mem:<memberId>` or `reg:<registrationId>` | `apps/api/src/routes/public.ts` | checkout (AI 5) | webhook handler (Dev 1), matcher (AI 4) |
| `recordCapture(customId, captureId, cents)`: idempotent ledger write for a capture | `apps/api/src/routes/public.ts` | AI 5 | capture-on-return (AI 5), webhook `PAYMENT.CAPTURE.COMPLETED` (Dev 1) |
| Ledger row per PayPal object, unique on `(paypal_object_type, paypal_object_id)` | `packages/db/src/schema.ts` | everyone who records money | AG Grid ledger (Dev 2), recon (AI 4) |

## Ground rules from the report

1. **Money is integer cents.** Use `@treasurer/shared` money helpers. No floats, ever.
2. **Numbers come from code.** An LLM never writes a figure that reaches a user. See `packages/comms/src/slots.ts` for the pattern.
3. **Write tools only propose.** Only the policy engine calls Payouts or Refunds, and only after a rule check and approval.
4. **Untrusted text stays data.** Wrap receipts, emails, uploads and web pages with `untrusted()` from `@treasurer/llm`.
5. **Idempotency everywhere.** `PayPal-Request-Id` on every write (the client refuses writes without one), `sender_batch_id` on every batch, webhook event id on every handler.
6. **Audit everything.** Proposals, rule results, approvals and PayPal calls go to `audit_events`, which is append-only.

## Working agreement

- Branch per feature: `ai5/prize-preview`, `dev1/webhooks`.
- `npm run typecheck && npm test` must pass before you open a PR.
- Use the LLM fake (`createFakeLlm`) in tests. CI never calls a real model.
- Schema changes: edit `packages/db/src/schema.ts`, run `npm run db:generate`, and commit the migration.
