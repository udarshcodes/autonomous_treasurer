"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents, postJson, type PublicEvent } from "@/lib/api";

interface MemberInput {
  name: string;
  email: string;
}

interface RegistrationResult {
  registrationId: string;
  feeCents: number;
  payMode: "team" | "split";
  leadPayToken: string;
  members: Array<{ name: string; email: string; isLead: boolean; shareCents: number; payLink: string }>;
}

const MAX_MEMBERS = 6;

export function RegisterForm({ event }: { event: PublicEvent }) {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<MemberInput[]>([{ name: "", email: "" }]);
  const [payMode, setPayMode] = useState<"team" | "split">("team");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const update = (i: number, patch: Partial<MemberInput>) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<RegistrationResult>(`/public/events/${event.slug}/registrations`, {
        teamName: teamName || members[0]?.name,
        members,
        payMode: members.length === 1 ? "team" : payMode,
      });
      if (res.payMode === "team") router.push(`/e/${event.slug}/pay/${res.leadPayToken}?scope=team`);
      else setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>You're registered</h2>
        <p>Each teammate pays their own share using their link. We've emailed it to them too. Your team is confirmed once everyone has paid.</p>
        <ul className="plain">
          {result.members.map((m) => (
            <li key={m.email} style={{ display: "block" }}>
              <strong>{m.name}</strong> · {formatCents(m.shareCents)}
              <br />
              <code className="link">{m.payLink}</code>
            </li>
          ))}
        </ul>
        <p>
          <a className="button" href={result.members[0]!.payLink}>
            Pay my share
          </a>
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="team">Team name</label>
      <input id="team" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Leave empty if you're solo" maxLength={80} />

      <h2>Members</h2>
      <p className="muted">The first person is the team lead.</p>
      {members.map((m, i) => (
        <div className="row" key={i}>
          <div>
            <label htmlFor={`name-${i}`}>Name</label>
            <input id={`name-${i}`} required value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`email-${i}`}>Email</label>
            <input id={`email-${i}`} required type="email" value={m.email} onChange={(e) => update(i, { email: e.target.value })} />
          </div>
          {members.length > 1 && (
            <button type="button" className="secondary" style={{ flex: "0 0 auto" }} onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove member ${i + 1}`}>
              ✕
            </button>
          )}
        </div>
      ))}
      {members.length < MAX_MEMBERS && (
        <p>
          <button type="button" className="secondary" onClick={() => setMembers((ms) => [...ms, { name: "", email: "" }])}>
            Add teammate
          </button>
        </p>
      )}

      {members.length > 1 && (
        <>
          <label htmlFor="paymode">Payment</label>
          <select id="paymode" value={payMode} onChange={(e) => setPayMode(e.target.value as "team" | "split")}>
            <option value="team">I'll pay for the whole team now</option>
            <option value="split">Everyone pays their own share</option>
          </select>
        </>
      )}

      <p>
        Total: <strong>{formatCents(event.feeCents * members.length)}</strong>
      </p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Registering…" : "Continue to payment"}
      </button>
    </form>
  );
}
