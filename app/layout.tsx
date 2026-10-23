import "./globals.css";
import { DM_Sans, Inter } from "next/font/google";
const dm = DM_Sans({ subsets: ["latin"], variable: "--dm", weight: ["500", "600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--in" });
export const metadata = { title: "Agent Guard — payment control for AI agents", description: "Planner → checks → verifier → Airwallex, with a hash-chained audit log." };
export const viewport = { width: "device-width", initialScale: 1 };
export default function L({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${dm.variable} ${inter.variable}`}><body>{children}</body></html>;
}
