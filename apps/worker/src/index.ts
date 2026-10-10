/**
 * Background worker — owners: Dev 1 (scheduling, payout status polling),
 * AI 4 (nightly Transaction Search cross-check), AI 5 (nudge scans), AI 2 (sponsor reminder timing).
 *
 * On Render this runs as a cron job: `npm run start --workspace @treasurer/worker -- <job>`.
 */
const jobs: Record<string, () => Promise<void>> = {
  async nudges() {
    // TODO(AI 5 / Dev 1): for each active event, POST-equivalent of /api/events/:id/nudges/scan,
    // then send approved drafts. Kept manual (treasurer clicks send) until email delivery exists.
    console.log("nudges: not scheduled yet");
  },
  async recon() {
    console.log("TODO(AI 4): nightly Transaction Search cross-check");
  },
  async payouts() {
    console.log("TODO(Dev 1): poll pending payout batches");
  },
};

const jobName = process.argv[2] ?? "";
const job = jobs[jobName];
if (!job) {
  console.error(`Usage: worker <${Object.keys(jobs).join("|")}>`);
  process.exit(1);
}
await job();

export {};
