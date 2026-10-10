# Submission kit

Owner: AI 5. Copy from here into the hackathon form. Update the bracketed parts before submitting.

## Project name

Autonomous Treasurer

## Tagline (one line)

An AI treasurer for student clubs that collects, reimburses, pays and reconciles through PayPal, and cannot spend outside policy.

## Text description

Student clubs move real money with no finance staff and a treasurer who changes every year. Registration fees, sponsor invoices, volunteer reimbursements, prizes and refunds end up spread across a Google Form, a payment link, a spreadsheet and a WhatsApp group.

Autonomous Treasurer is an agent that runs the money side of a club event. It does the treasurer's routine work end to end. PayPal executes every money movement, and humans approve only what policy says they must.

- **Registration and team payments (PayPal Orders).** Teams pay together or split the fee. Each payment carries its registration id, so the ledger matches it without guessing. When a teammate hasn't paid, the agent drafts the nudge.
- **Sponsor invoicing (PayPal Invoicing).** Paste a sponsor's email. The agent extracts tier, amount and due date, drafts the invoice, and decides when to send reminders.
- **Receipt reimbursements (PayPal Payouts).** A volunteer photographs a receipt. A vision model reads it, code re-adds the line items, it is mapped to a budget line, and duplicates are caught.
- **Tiered approvals.** Every outgoing payment becomes an approval card that says what the money is for, which budget line it hits and what remains. Every figure on the card is inserted by code, never written by the model.
- **Prize payouts (PayPal Payouts, batch).** Paste the winners list. It is checked against registrations (unknown teams, wrong amounts, recipients who aren't on the team) and paid in one idempotent batch.
- **Cancellation refunds (PayPal Payments).** "Refund everyone in Workshop B" becomes a previewed plan, then one refund per registration.
- **Reconciliation (Webhooks and Transaction Search).** Webhooks keep the ledger live. Deterministic matching handles most records, and the LLM explains only the leftovers.

**Governed autonomy.** The agent can only *propose*. Hard rules are plain code: per-transaction cap, budget-line cap, recipient allowlist, daily cap, duplicate guard and refund bound. They run before any human sees a request. A vendor quote with hidden instructions can make the agent propose a payment to an unknown account, and the recipient rule blocks it. Every proposal, rule result, approval and PayPal response goes into an append-only audit log.

## How we used PayPal

| PayPal API | What it does in the product |
|---|---|
| Orders v2 | Registration and team checkout; `custom_id` ties each capture to its registration |
| Invoicing v2 | Sponsor invoices, sends and reminders |
| Payouts v1 | Volunteer reimbursements and batch prize payouts (`purpose: PRIZES`, idempotent `sender_batch_id`) |
| Payments v2 | Refunds for the cancelled workshop, one `PayPal-Request-Id` per refund |
| Webhooks | Live ledger updates for captures, refunds, invoice payments and payout items |
| Transaction Search | Nightly cross-check and the closing statement |
| Agent Toolkit | Read-only tools for the agent (orders, invoices, transactions) |

## How we used AI

| Job | Technique | Guardrail |
|---|---|---|
| Plan multi-step work from the console | Tool-calling agent with a small typed tool set | Write tools return proposals; plans are previewed |
| Read receipts and sponsor emails | Vision and structured output against JSON schemas | Totals re-added in code; low-confidence fields shown as "needs review" |
| Map spend to budget lines | Classification against the event's real budget lines | AI intent check flags mismatches (pizza claimed against Venue) |
| Reconcile | Deterministic matching first, LLM for the leftovers | LLM matches are labelled as suggestions |
| Explain approvals, write nudges and reminders | LLM writes wording around `{slots}` | Code rejects any draft containing a typed digit, amount or link, and fills every figure |
| Read messy prize lists | Structured extraction | Amounts and emails must appear verbatim in the source, and are parsed by code |

Evaluation numbers are in the README: receipt extraction accuracy, reconciliation catch rate and prompt-injection outcomes.

## Tools used

[Keep this in sync with the README "Tools" table.]

## Links

- Repo: [GitHub URL]
- Live demo: [Render URL] (demo mode, no PayPal account needed)
- Video: [YouTube URL]
- Postman collection: `postman/autonomous-treasurer.postman_collection.json`

## Prize categories to tick

- [ ] Best Use of PayPal + AI
- [ ] Best Use of Agentic Commerce
- [ ] Most Impactful
- [ ] Best Demo Delivery
- [ ] Best Use of AG Grid
- [ ] Best Use of Bryntum (if the timeline ships)
- [ ] Best Use of Render
- [ ] Best Use of Channel3 / APIMatic (only if actually used)

## Final checklist (from the report)

- [ ] Public GitHub repo with all source, assets and seed data
- [ ] MIT licence visible in the repo's About section
- [ ] README: problem, features, architecture diagram, tools with how each is used, AI eval numbers
- [ ] Setup works from a clean clone (env vars, sandbox setup, seed, run)
- [ ] Hosted demo on Render with seeded data and a reset script
- [ ] Demo mode that needs no PayPal account
- [ ] Postman collection linked from the README
- [ ] Video under 3 minutes, public on YouTube, link on the form
- [ ] Video checked for third-party music, logos and trademarks
- [ ] Prize categories selected
- [ ] Run-through by someone who didn't build it, using the README only
