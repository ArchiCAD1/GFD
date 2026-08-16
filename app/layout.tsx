import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gerardo Faustin Designs — Architecture, Engineering & Interiors",
  description: "Architecture, engineering, interiors, and project applications by Gerardo Faustin Designs in Jamaica.",
};

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
