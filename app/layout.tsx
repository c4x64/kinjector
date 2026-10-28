import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://kinjector.vercel.app"),
  title: "kinjector — kernel GOT injector for Android arm64",
  description:
    "A corrected arm64 kernel module that loads a userspace payload into a running Android process through a single GOT slot. No .text writes, no RWX, no VMA unlinking.",
  openGraph: {
    title: "kinjector — kernel GOT injector",
    description:
      "One PLT slot. Two anonymous pages. Zero bytes of .text written.",
    type: "website",
    url: "https://kinjector.vercel.app",
    images: [{ url: "/krishna.png", width: 1000, height: 1000 }],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
