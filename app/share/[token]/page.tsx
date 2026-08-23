import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { raidData } from "../../../lib/raid-data";
import { getSharedPlayer } from "../../../lib/share";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const player = await getSharedPlayer(token);
  if (!player) return { title: "Private report unavailable", robots: { index: false, follow: false } };
  const description = `${player.name}'s private raid review: mechanics, performance, attendance, preparation, and focused takeaways.`;
  return {
    title: `${player.name} · Private raid review`, description, robots: { index: false, follow: false },
    openGraph: { title: `${player.name} · Private raid review`, description, images: [] },
    twitter: { card: "summary", title: `${player.name} · Private raid review`, description, images: [] },
  };
}

export default async function SharedPlayerPage({ params }: Props) {
  const { token } = await params;
  const player = await getSharedPlayer(token);
  if (!player) notFound();
  const scores = [
    ["Mechanics", player.scores.mechanics, "Wipefest mechanics"], ["Performance", player.scores.performance, player.parse === null ? "Not available" : `${player.parse}th percentile`],
    ["Attendance", player.scores.attendance, player.attendanceLabel], ["Preparation", player.scores.preparation, player.prepLabel],
  ] as const;
  const raidMechanicsAverage = player.raidAverages ? player.raidAverages.mechanics : raidData.raidAverages.mechanics;
  return (
    <main className="private-shell">
      <header className="private-topbar">
        <Link className="brand" href="/" aria-label="Scurvy Dogs home"><span className="brand-mark">SD</span><span><strong>Scurvy Dogs</strong><small>Private player review</small></span></Link>
        <span className="privacy-badge">Player-only view</span>
      </header>
      <section className="private-report">
        <p className="eyebrow"><span /> {raidData.raidNight}</p>
        <div className="private-hero">
          <div><h1>{player.name}&apos;s raid review</h1><p>{player.summary}</p></div>
          <div className="player-seal"><strong>{player.name.slice(0, 2).toUpperCase()}</strong><span>{player.spec}<br />{player.className}</span></div>
        </div>
        <section className="score-grid private-scores" aria-label={`${player.name}'s scores`}>
          {scores.map(([label, value, note], index) => <article className={`score-card tone-${index} ${value === null ? "score-unavailable" : ""}`} key={label}><div className="score-heading"><span>{label}</span><small>{note}</small></div><div className="score-value">{value ?? "N/A"}{value !== null && <span>/100</span>}</div><div className="score-track"><i style={{ width: `${value ?? 0}%` }} /></div></article>)}
        </section>
        <section className="private-insights">
          <article className="panel"><p className="eyebrow"><span /> What went well</p><h2>Keep doing this</h2><ul className="plain-findings">{player.wins.map((win) => <li key={win}><span>✓</span>{win}</li>)}</ul></article>
          <article className="panel"><p className="eyebrow amber"><span /> Best next step</p><h2>Focus here</h2><ul className="plain-findings focus">{player.focus.map((item) => <li key={item}><span>!</span>{item}</li>)}</ul></article>
        </section>
        <section className="anonymous-context panel">
          <div><p className="eyebrow muted"><span /> Anonymous context</p><h2>How this compares</h2><p>Only raid averages are shown. No other player names or individual reports are included.</p></div>
          <div className="average-comparison"><span>You <strong>{player.scores.mechanics}</strong></span><i><b style={{ width: `${player.scores.mechanics ?? 0}%` }} /></i><span>Raid average <strong>{raidMechanicsAverage ?? "N/A"}</strong></span><i className="average"><b style={{ width: `${raidMechanicsAverage ?? 0}%` }} /></i></div>
        </section>
        <footer className="private-footer">This link contains only {player.name}&apos;s detail and anonymous raid context.</footer>
      </section>
    </main>
  );
}
