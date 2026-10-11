import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError, formatCents, type PublicEvent } from "@/lib/api";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let event: PublicEvent;
  try {
    event = await api<PublicEvent>(`/public/events/${slug}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main>
      <h1>{event.name}</h1>
      <p className="muted">Registration is {formatCents(event.feeCents)} per person, paid securely with PayPal.</p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Participants</h2>
        <p>Register yourself or your team. Pay for everyone at once, or let each teammate pay their own share.</p>
        <Link className="button" href={`/e/${slug}/register`}>
          Register
        </Link>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Volunteers</h2>
        <p>Bought something for the event? Upload the receipt and get paid back to your PayPal email.</p>
        <Link className="button" href={`/e/${slug}/reimburse`}>
          Upload a receipt
        </Link>
      </div>
    </main>
  );
}
