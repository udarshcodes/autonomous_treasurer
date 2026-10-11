"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";

export function ReceiptForm({ slug }: { slug: string }) {
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/public/events/${slug}/receipts`, { method: "POST", body: new FormData(form) });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      setStatus({ kind: "ok", text: body.message ?? "Receipt received." });
      form.reset();
      setPreview(null);
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="name">Your name</label>
      <input id="name" name="name" required maxLength={120} />

      <label htmlFor="email">PayPal email</label>
      <input id="email" name="email" type="email" required maxLength={200} />

      <label htmlFor="receipt">Receipt photo</label>
      <input
        id="receipt"
        name="receipt"
        type="file"
        required
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setPreview(file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
        }}
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Receipt preview" style={{ maxWidth: "100%", marginTop: 12, borderRadius: 8 }} />
      )}

      <label htmlFor="note">What was it for? (optional)</label>
      <textarea id="note" name="note" rows={2} maxLength={500} placeholder="e.g. Pizza for the volunteer dinner" />

      <p>
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Submit receipt"}
        </button>
      </p>
      {status && <p className={status.kind}>{status.text}</p>}
    </form>
  );
}
