import type { Metadata, Viewport } from "next";
import { Arimo } from "next/font/google";
import "./globals.css";
import "./themes.css";

export const metadata: Metadata = {
  title: "Time Crunch",
  description: "Jet Lag: Chicago — Time Crunch",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Helvetica stand-in for phones and computers that don't have Helvetica.
const arimo = Arimo({ subsets: ["latin"], variable: "--font-arimo" });

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme switches on the L Platform design in themes.css.
    <html lang="en" data-theme="platform" className={`h-full antialiased ${arimo.variable}`}>
      <body className="min-h-full bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-lg px-4 py-6">
          {children}
        </div>
      </body>
    </html>
  );
}
