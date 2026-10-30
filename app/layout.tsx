import type { Metadata } from "next";
import "./globals.css";
// Important for MapLibre CSS
import "maplibre-gl/dist/maplibre-gl.css";
import { Analytics } from "@/components/Analytics";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "One day of Citi Bike",
  description: "Every Citi Bike ride in New York on one day, drawn as moving light.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
