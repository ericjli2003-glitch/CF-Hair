import { redirect } from "next/navigation";
import { Logo } from "@/components/art/Logo";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdminSession()) redirect("/admin");
  const enabled = !!process.env.ADMIN_PASSWORD;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section aria-label="Welcome" className="relative hidden bg-primary lg:block">
        <div className="absolute bottom-12 left-12 text-paper">
          <p className="display text-[3.4rem] leading-none">Good to see you.</p>
          <p className="mt-3 text-[0.95rem] text-on-primary-soft">Your bookings, messages and clients in one place.</p>
        </div>
      </section>
      <main className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <Logo size={40} />
          <h1 className="display mt-10 text-[2.6rem]">Owner login</h1>
          {enabled ? (
            <LoginForm />
          ) : (
            <p className="mt-6 rounded-xl bg-paper p-4 text-sm text-ink-soft ring-1 ring-line">
              Set <code>ADMIN_PASSWORD</code> in the environment to enable the owner dashboard.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
