import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { contexto } from "@/lib/session";
import { LoginView } from "@/views/Login";

export const metadata: Metadata = { title: "Acesso" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await contexto()) redirect("/");
  let temDemo = false;
  try {
    const [r] = await db.select({ n: sql<string>`count(*)` }).from(sql`nk_usuario`);
    temDemo = Number(r?.n ?? 0) > 0;
  } catch {
    temDemo = false;
  }
  return <LoginView temDemo={temDemo} />;
}
