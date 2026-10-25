import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { isLocked } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
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

export const metadata: Metadata = {
  title: "Edge Watch",
  description: "Monitor Ribbon SBC Edge SIP trunks and send email when one goes down.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locked = await isLocked();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        {locked ? <LoginForm /> : children}
        <Toaster />
      </body>
    </html>
  );
}
