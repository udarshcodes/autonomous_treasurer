import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { PayPanel, type PayInfo } from "./pay-panel";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { token } = await params;
  const { scope } = await searchParams;
  let info: PayInfo;
  try {
    info = await api<PayInfo>(`/public/pay/${token}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return (
    <main>
      <h1>{info.event.name}</h1>
      <p className="muted">Team {info.teamName}</p>
      <PayPanel
        token={token}
        info={info}
        initialScope={scope === "team" && info.member.isLead ? "team" : "member"}
        clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
      />
    </main>
  );
}
