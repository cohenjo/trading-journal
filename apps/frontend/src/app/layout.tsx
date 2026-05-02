import "./globals.css";
import { type Metadata } from "next";
import { type ReactNode } from "react";
import { SettingsProvider } from "./settings/SettingsContext";
import MainLayout from "@/components/Layout/MainLayout";
import PageLoadMetrics from "@/components/Telemetry/PageLoadMetrics";

export const metadata: Metadata = {
  title: "Trading Journal",
  description: "Personal finance and trading journal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <PageLoadMetrics />
        <SettingsProvider>
          <MainLayout>
            {children}
          </MainLayout>
        </SettingsProvider>
      </body>
    </html>
  );
}
