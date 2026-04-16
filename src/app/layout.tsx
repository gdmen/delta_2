import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Delta",
  description: "Fitness coaching dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Sidebar />
        <main className="md:ml-[200px] pt-16 md:pt-8 px-4 md:px-10 pb-8 max-w-[1400px]">
          {children}
        </main>
      </body>
    </html>
  );
}
