/**
 * `npm run seed` — owner: AI 4.
 * One command creates the demo event, 300 registrations with planted errors,
 * sponsors, volunteers, vendors and receipts, so the demo is repeatable and judges can run it.
 *
 * Fixed ids other people depend on (Postman collection, demo script, tests):
 *   event         id "evt_demo", slug "hackfest", name "HackFest 2026", fee $25/person
 *   budget lines  "bl_prizes" (Prizes, $2,000), "bl_catering", "bl_venue", "bl_swag"
 *   teams         "Null Pointers", "Byte Me", "Stack Smashers" fully paid (prize winners),
 *                 at least one partially paid team for the nudge scene
 *   volunteer     Priya Shah <priya@example.edu>
 *   workshop      track "Workshop B" with 42 paid registrations (bulk refund scene)
 */
console.log("TODO(AI 4): seed the demo event. See docs/ownership.md.");
