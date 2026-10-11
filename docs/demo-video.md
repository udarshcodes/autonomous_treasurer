# Demo video: script and shot list

Owner: AI 5. Target length is **2:50**; the hard limit is 3:00. Publish it on YouTube as **Public** (not Unlisted) and put the link on the submission form.

The video tells one story: HackFest 2026, a 300-person hackathon, from sponsor sign-up to closing statement. Every scene ends on a visible PayPal result. Keep narration short and let the screen do the work.

## Fixed demo data

Use the same names and amounts in every scene. Consistency is what makes this read as one product rather than a feature tour. These names come from the seed (`npm run seed`, see `packages/recon/src/seed/cli.ts`).

| Thing | Value |
|---|---|
| Event | HackFest 2026, 300 participants, $25 per person |
| Sponsor | Acme Cloud, Gold tier, $2,500, due 10 October |
| Partial team | Merge Conflict: Ivan paid, Jo has not |
| Volunteer | Priya Shah, pizza receipt for $86.40, Catering line |
| Injection | Vendor quote asking for $900 to an unknown account |
| Cancelled workshop | Workshop B, 42 registrations |
| Winners | 1st Null Pointers $1,000 · 2nd Byte Me $500 · 3rd Stack Smashers $250 |

## Script

| Time | Scene | On screen | Narration (keep it this short) | PayPal result shown |
|---|---|---|---|---|
| 0:00–0:15 | The problem | Split screen: a messy spreadsheet, a WhatsApp reimbursement thread, a sponsor email | "Every student club runs real money with none of the tools." | None |
| 0:15–0:35 | Sponsor invoicing | Paste Acme Cloud's email into the console. Extracted tier, amount and due date appear. Approve, and the invoice is sent. | "Paste the sponsor's email. The agent drafts the invoice; we approve it." | **Sandbox:** the invoice in the sponsor's inbox, then paid |
| 0:35–0:55 | Registrations | `/e/hackfest/register` on a phone frame, paid with PayPal. Ledger rows arrive live. Merge Conflict shows 1 of 2 paid; the console shows the drafted nudge to Jo. | "Teams pay together or split it. When someone hasn't paid, the agent writes the nudge, and every number in it comes from the ledger." | Captured orders appear in the ledger through the webhook |
| 0:55–1:20 | Receipt reimbursement | Priya photographs the receipt at `/e/hackfest/reimburse`. Fields are extracted and mapped to Catering. The approval card shows the budget impact; tap approve. | "Volunteers snap a receipt. The approver sees what it's for and what's left on the line, then taps approve." | **Sandbox:** payout received in Priya's account |
| 1:20–1:45 | The injection moment | The vendor quote has hidden text telling the agent to pay $900 to an unknown account. The agent proposes it; the card reads **Blocked** and names the rule. | "Here's a quote with hidden instructions. The agent falls for it, and it doesn't matter. The rule is code, so nothing moves." | Nothing moves; the blocked request is in the audit log |
| 1:45–2:05 | Bulk refund | Console: "Workshop B is cancelled, refund everyone." Preview: 42 people, total. Confirm. | "One sentence becomes forty-two refunds, previewed first." | 42 refunds complete; ledger updates |
| 2:05–2:25 | Reconciliation | Click Reconcile: 300 matched, 4 flagged with explanations (1 duplicate, 1 wrong amount, 2 orphan payments). | "Three hundred payments matched. Four flagged, each with a reason." | Each row links to its PayPal transaction |
| 2:25–2:40 | Prize payouts and timeline | Paste the winners list. The preview catches a typo'd team name; fix it. Approve the batch. Cut to the Bryntum timeline with every milestone done. | "Winners checked against registrations, paid in one batch." | **Sandbox:** batch payout to three teams |
| 2:40–2:50 | Close | Closing statement, then the repo and live demo URLs | "Autonomous Treasurer: a treasurer for every student club. Built on PayPal." | None |

## Recording checklist

- [ ] Reset and seed before each take: `npm run db:migrate && npm run seed`.
- [ ] Record each scene separately against the seeded sandbox, then cut them together. Live single-take demos fail on network latency.
- [ ] Show **real PayPal sandbox pages at least twice**: the sponsor's invoice and a payout receipt.
- [ ] Browser zoom at 125%, a clean browser profile, no bookmarks bar, no personal tabs.
- [ ] No third-party logos or trademarks in frame, apart from the PayPal pages themselves. Use made-up sponsor names only.
- [ ] Royalty-free music or none. Check the licence and keep it in `docs/music-licence.txt` if used.
- [ ] Keep the injection scene whatever else gets cut. It is the most memorable 25 seconds and it carries the Innovation argument on its own.
- [ ] Captions on (YouTube auto captions, then fix the product names).
- [ ] Final length is at or under 2:55, leaving a buffer before 3:00.
- [ ] Upload as **Public**, title it "Autonomous Treasurer: an AI treasurer that moves money through PayPal, under policy", and paste the link into the README and the submission form.

## Fallbacks if a feature isn't ready

Follow the report's cut list. Scenes that never get cut: the **policy block (injection)**, **reconciliation**, and at least one **real sandbox payout**. If Bryntum is cut, end scene 8 on the ledger filtered to completed milestones instead.
