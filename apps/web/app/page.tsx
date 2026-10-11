import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Autonomous Treasurer</h1>
      <p className="muted">An AI treasurer for student clubs and events, with PayPal moving every dollar.</p>
      <div className="card">
        <p>
          <Link href="/workspace">Treasurer workspace</Link>
        </p>
        <p>
          <Link href="/e/hackfest">Demo event public page</Link>
        </p>
      </div>
    </main>
  );
}
