import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import "./globals.css";

const appleGaramond = localFont({
  src: "./fonts/AppleGaramond-Light.ttf",
  variable: "--font-apple-garamond",
  weight: "300"
});

const rasterGrotesk = localFont({
  src: "./fonts/FKRasterGroteskCompact-Blended.otf",
  variable: "--font-raster-grotesk"
});

const formulaOne = localFont({
  src: "./fonts/Formula1-Regular.otf",
  variable: "--font-formula-one"
});

export const metadata: Metadata = {
  title: "fasttab.cc",
  description: "Split restaurant tabs by text with the FastTab agent."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${appleGaramond.variable} ${rasterGrotesk.variable} ${formulaOne.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
