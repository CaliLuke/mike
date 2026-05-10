import "./globals.css";

import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";

import { TelemetryBootstrap } from "@/app/components/TelemetryBootstrap";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Luke - AI Job Search Assistant",
  description: "AI-powered job search and application assistance platform.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}>
        <TelemetryBootstrap />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
