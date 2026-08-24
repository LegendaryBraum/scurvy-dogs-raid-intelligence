import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPrivatePlayerWorkspace } from "../../../lib/player-access-data";
import { getSharedPlayer } from "../../../lib/share";
import { PrivatePlayerDashboard } from "./PrivatePlayerDashboard";

type Props = { params: Promise<{ token: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const player = await getSharedPlayer(token);
  if (!player) return { title: "Private report unavailable", robots: { index: false, follow: false } };
  const description = `${player.name}'s complete private raid dashboard: every pull, boss, mechanic, Spell ID, performance result, and raid-night trend.`;
  return {
    title: `${player.name} · Private raid dashboard`, description, robots: { index: false, follow: false },
    openGraph: { title: `${player.name} · Private raid dashboard`, description, images: [] },
    twitter: { card: "summary", title: `${player.name} · Private raid dashboard`, description, images: [] },
  };
}

export default async function SharedPlayerPage({ params }: Props) {
  const { token } = await params;
  const workspace = await loadPrivatePlayerWorkspace(token);
  if (!workspace) notFound();
  return <PrivatePlayerDashboard initialWorkspace={workspace} token={token} />;
}
