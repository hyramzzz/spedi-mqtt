import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "./components/dashboard-layout";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "SPEDI Dashboard",
  description: "Advanced Orchestration for Autonomous Systems",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(dmSans.variable, "font-sans", jetbrainsMono.variable, "dark")}>
      <body className="font-sans antialiased text-zinc-50 bg-background overflow-hidden h-screen flex">
        <DashboardLayout>
          {children}
        </DashboardLayout>
      </body>
    </html>
  );
}
