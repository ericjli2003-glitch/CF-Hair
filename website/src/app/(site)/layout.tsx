import { LangProvider } from "@/components/LangProvider";
import { BookBar } from "@/components/site/BookBar";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, salon } from "@/lib/salon";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { lang, t } = await getI18n();
  return (
    <LangProvider lang={lang}>
      <div className="site flex min-h-screen flex-col bg-tile">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {t.nav.skip}
        </a>
        <Header phone={salon.phone} phoneDisplay={formatPhoneDisplay(salon.phone)} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer t={t} lang={lang} />
        <BookBar phone={salon.phone} />
      </div>
    </LangProvider>
  );
}
