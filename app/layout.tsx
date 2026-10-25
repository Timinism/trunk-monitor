import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { LoginFallback, LoginForm } from "@/components/login-form";
import { localLoginAvailable } from "@/lib/accounts";
import { isLocked } from "@/lib/auth";
import { oidcConfigured } from "@/lib/oidc";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edge Watch",
  description: "Monitor Ribbon SBC Edge SIP trunks and send email when one goes down.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locked = await isLocked();
  const local = locked ? localLoginAvailable() : false;
  const oidc = locked ? oidcConfigured() : false;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        {locked ? (
          <Suspense fallback={<LoginFallback />}>
            <LoginForm local={local} oidc={oidc} />
          </Suspense>
        ) : (
          children
        )}
        <Toaster />
      </body>
    </html>
  );
}
