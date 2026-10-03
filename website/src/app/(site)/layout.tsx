import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { LangProvider } from "@/components/LangProvider";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, salon } from "@/lib/salon";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { lang, t } = await getI18n();
  return (
    <LangProvider lang={lang}>
      <div className="grain flex min-h-screen flex-col">
        <Header phone={salon.phone} phoneDisplay={formatPhoneDisplay(salon.phone)} />
        <main className="flex-1">{children}</main>
        <Footer t={t} lang={lang} />
      </div>
    </LangProvider>
  );
}
