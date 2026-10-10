import { notFound } from "next/navigation";
import { api, ApiError, type PublicEvent } from "@/lib/api";
import { ReceiptForm } from "./receipt-form";

export default async function ReimbursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const event = await api<PublicEvent>(`/public/events/${slug}`);
    return (
      <main>
        <h1>Get reimbursed</h1>
        <p className="muted">
          {event.name}: upload a photo of your receipt. Once it's approved, the money goes to your PayPal email.
        </p>
        <ReceiptForm slug={slug} />
      </main>
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
