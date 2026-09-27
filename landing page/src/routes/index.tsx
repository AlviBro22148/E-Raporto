import { createFileRoute } from "@tanstack/react-router";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { AIEngine, Duplicates, How, Innovation, Municipality, Problem, Stats, Trust } from "@/components/landing/Sections";
import { Closing, Footer } from "@/components/landing/Closing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "E-Raporto — Raporto problemet e qytetit | Bashkia Elbasan" },
      { name: "description", content: "Fotografo një problem në qytet — E-Raporto e klasifikon me AI, e drejton te dega e duhur e Bashkisë Elbasan dhe të njofton në kohë reale." },
      { property: "og:title", content: "E-Raporto — Një kanal i vetëm për çdo problem të qytetit" },
      { property: "og:description", content: "Raportimi qytetar për Elbasanin: klasifikim me AI, zbulim dublikatash dhe zgjidhje e verifikuar nga qytetari." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <LanguageProvider>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <How />
        <AIEngine />
        <Duplicates />
        <Innovation />
        <Trust />
        <Municipality />
        <Stats />
        <Closing />
      </main>
      <Footer />
    </LanguageProvider>
  );
}
