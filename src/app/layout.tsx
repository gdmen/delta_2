import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Delta 2",
  description: "Fitness coaching dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex">
        <Sidebar />
        <main className="ml-[200px] flex-1 p-8 max-w-[900px]">
          {children}
        </main>
      </body>
    </html>
  );
}
