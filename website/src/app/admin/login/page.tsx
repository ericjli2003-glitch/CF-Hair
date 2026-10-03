import { redirect } from "next/navigation";
import { Logo } from "@/components/art/Monogram";
import { Strands } from "@/components/art/Strands";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdminSession()) redirect("/admin");
  const enabled = !!process.env.ADMIN_PASSWORD;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-espresso lg:block">
        <Strands className="absolute inset-0 h-full w-full" count={30} seed={3} />
        <div className="absolute bottom-12 left-12 text-paper">
          <p className="display text-[3.4rem] leading-none">Good to see you.</p>
          <p className="mt-3 text-sm text-paper/60">Your bookings, messages and clients in one place.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <Logo />
          <h1 className="display mt-10 text-[2.6rem]">Owner login</h1>
          {enabled ? (
            <LoginForm />
          ) : (
            <p className="mt-6 rounded-xl bg-paper p-4 text-sm text-ink-soft ring-1 ring-line">
              Set <code>ADMIN_PASSWORD</code> in the environment to enable the owner dashboard.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
