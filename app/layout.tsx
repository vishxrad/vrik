import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);

  return {
    metadataBase: baseUrl,
    title: "Zomato Delivery Partner Demo",
    description:
      "A mobile-first delivery partner interface grounded in Zomato’s Sushi design foundations.",
    openGraph: {
      title: "Delivery Partner — Sushi Design System",
      description: "A focused rider workflow built on Zomato’s Sushi foundations.",
      images: [{ url: new URL("/og-sushi.png", baseUrl), width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Delivery Partner — Sushi Design System",
      description: "A focused rider workflow built on Zomato’s Sushi foundations.",
      images: [new URL("/og-sushi.png", baseUrl)],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
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
