"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents, postJson } from "@/lib/api";

export interface PayInfo {
  event: { slug: string; name: string };
  teamName: string;
  status: string;
  member: { name: string; isLead: boolean };
  memberDueCents: number;
  teamOutstandingCents: number;
  team: Array<{ name: string; paid: boolean; isLead: boolean }>;
}

export function PayPanel({
  token,
  info,
  initialScope,
  clientId,
}: {
  token: string;
  info: PayInfo;
  initialScope: "member" | "team";
  clientId: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState(initialScope);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const due = scope === "team" ? info.teamOutstandingCents : info.memberDueCents;
  const paidCount = info.team.filter((m) => m.paid).length;

  return (
    <>
      <div className="card">
        <div className="muted">{scope === "team" ? "Team total due" : `${info.member.name}, your share`}</div>
        <div className="amount">{formatCents(due)}</div>
        {info.member.isLead && info.teamOutstandingCents > info.memberDueCents && (
          <p>
            <label style={{ display: "inline", fontWeight: 400 }}>
              <input
                type="checkbox"
                style={{ width: "auto", marginRight: 8 }}
                checked={scope === "team"}
                onChange={(e) => setScope(e.target.checked ? "team" : "member")}
              />
              Pay for everyone who hasn't paid yet
            </label>
          </p>
        )}
        {due === 0 ? (
          <p className="ok">
            <strong>Paid. Thank you!</strong>
          </p>
        ) : !clientId ? (
          <p className="error">Payments are not configured on this server.</p>
        ) : (
          <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
            <PayPalButtons
              key={scope}
              style={{ layout: "vertical", label: "pay" }}
              createOrder={async () => {
                setMessage(null);
                const { orderId } = await postJson<{ orderId: string }>("/public/orders", { token, scope });
                return orderId;
              }}
              onApprove={async (data) => {
                const res = await postJson<{ status: string }>(`/public/orders/${data.orderID}/capture`, {});
                if (res.status === "COMPLETED") {
                  setMessage({ kind: "ok", text: "Payment received. You'll get a PayPal receipt by email." });
                  router.refresh();
                } else {
                  setMessage({ kind: "ok", text: "Payment is processing. This page will update once PayPal confirms it." });
                }
              }}
              onError={(err) => setMessage({ kind: "error", text: `Payment failed: ${String(err.message ?? "unknown error")}` })}
            />
          </PayPalScriptProvider>
        )}
        {message && <p className={message.kind}>{message.text}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Team status: {paidCount} of {info.team.length} paid
        </h2>
        <ul className="plain">
          {info.team.map((m) => (
            <li key={m.name}>
              <span>
                {m.name}
                {m.isLead ? " (lead)" : ""}
              </span>
              <span className={m.paid ? "ok" : "muted"}>{m.paid ? "Paid" : "Not yet"}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
