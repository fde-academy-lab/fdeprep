import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FDE Prep", template: "%s | FDE Prep" },
  description: "Practice and assessment for FDE Academy cohorts.",
};

export const viewport: Viewport = {
  themeColor: "#0A0B0D",
  colorScheme: "dark",
};

// Browser extensions write attributes onto <html> and <body> before React
// hydrates: Grammarly adds data-gr-ext-installed and
// data-new-gr-c-s-check-loaded to <body>. React reads that as a server and
// client mismatch and Next's development overlay reports it as an error.
// suppressHydrationWarning covers these two elements' own attributes and
// nothing beneath them, so a real mismatch inside the page still surfaces.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}
          suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text" suppressHydrationWarning>{children}</body>
    </html>
  );
}
