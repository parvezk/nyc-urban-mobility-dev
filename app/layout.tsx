import type { Metadata } from "next";
import "./globals.css";
// Important for MapLibre CSS
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "NYC Urban Mobility Modernized",
  description: "High performance rendering of NYC Taxi Data.",
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
