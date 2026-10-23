import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Time Crunch",
  description: "Jet Lag: Chicago — Time Crunch",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
