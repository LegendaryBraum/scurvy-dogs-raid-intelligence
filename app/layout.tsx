import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const candidateHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const host = /^[a-z0-9.:-]+$/i.test(candidateHost) ? candidateHost : "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") === "http" || host.startsWith("localhost") ? "http" : "https";
  const imageUrl = `${protocol}://${host}/og.png`;
  const title = "Scurvy Dogs · Raid Intelligence";
  const description = "Readable Warcraft Logs analysis with separate mechanics, performance, attendance, and preparation scores.";
  return {
    title, description,
    openGraph: { title, description, type: "website", images: [{ url: imageUrl, width: 1730, height: 909, alt: "Scurvy Dogs Raid Intelligence score dashboard" }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
