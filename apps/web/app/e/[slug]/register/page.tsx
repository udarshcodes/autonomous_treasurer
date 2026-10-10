import { notFound } from "next/navigation";
import { api, ApiError, type PublicEvent } from "@/lib/api";
import { RegisterForm } from "./register-form";

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const event = await api<PublicEvent>(`/public/events/${slug}`);
    return (
      <main>
        <h1>Register for {event.name}</h1>
        <RegisterForm event={event} />
      </main>
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
