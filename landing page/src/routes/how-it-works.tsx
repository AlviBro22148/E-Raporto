import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LanguageProvider, useI18n } from "@/i18n/LanguageProvider";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Closing";
import { Kicker, Reveal } from "@/components/landing/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "Si funksionon E-Raporto — Udhëzues hap pas hapi" },
      { name: "description", content: "Udhëzues i plotë për qytetarët: nga krijimi i llogarisë te raportimi, ndjekja e statusit dhe konfirmimi i zgjidhjes në E-Raporto." },
      { property: "og:title", content: "Si të përdorësh E-Raporto, hap pas hapi" },
      { property: "og:description", content: "Çdo ekran i aplikacionit E-Raporto, nga llogaria deri te zgjidhja e problemit." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GuidePage,
});

/**
 * Screenshots per language, keyed by data-screenshot id (step-1 … step-12, staff).
 * Albanian files are "hapiN", English files "stepN".
 */
const alFiles = import.meta.glob<{ url: string }>("../assets/guide/hapi*.asset.json", { eager: true, import: "default" });
const enFiles = import.meta.glob<{ url: string }>("../assets/guide/step*.asset.json", { eager: true, import: "default" });
function toMap(files: Record<string, { url: string }>) {
  const m: Record<string, string> = {};
  for (const [path, a] of Object.entries(files)) {
    const n = path.match(/(\d+)\.[a-z]+\.asset\.json$/)?.[1];
    if (n) m[`step-${n}`] = a.url;
  }
  return m;
}
const SCREENSHOTS: Record<"al" | "en", Record<string, string>> = { al: toMap(alFiles), en: toMap(enFiles) };

/** Google Pixel 10-style frame: thin even bezels, centered punch-hole camera, right-side buttons. Screen ratio 1080x2424. */
function PhoneFrame({ id, label, dark }: { id: string; label: string; dark?: boolean }) {
  const { lang } = useI18n();
  const src = SCREENSHOTS[lang]?.[id];
  return (
    <div data-screenshot={id} className="relative mx-auto w-[230px] sm:w-[260px]">
      {/* right-side power + volume buttons */}
      <span className={cn("absolute -right-[3px] top-[22%] h-10 w-[3px] rounded-r", dark ? "bg-ice/30" : "bg-navy")} />
      <span className={cn("absolute -right-[3px] top-[34%] h-20 w-[3px] rounded-r", dark ? "bg-ice/30" : "bg-navy")} />
      <div className={cn("rounded-[2.25rem] p-[7px] shadow-lift", dark ? "bg-navy-deep ring-1 ring-ice/15" : "bg-navy")}>
        <div className="relative aspect-[1080/2424] overflow-hidden rounded-[1.9rem] bg-card">
          {src ? (
            <img key={src} src={src} alt={label} loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <>
              <div className="absolute left-1/2 top-2.5 z-10 h-3 w-3 -translate-x-1/2 rounded-full bg-navy" />
              <div className="absolute inset-3 top-8 flex items-center justify-center rounded-2xl border-2 border-dashed border-ink-3/40 bg-muted p-4 text-center text-sm text-ink-3">
                {label}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Guide() {
  const { t } = useI18n();
  const g = t.guide;
  // Preload both languages' screenshots so switching language is instant.
  useEffect(() => {
    for (const map of Object.values(SCREENSHOTS)) for (const url of Object.values(map)) { const im = new Image(); im.src = url; }
  }, []);
  return (
    <>
      <Nav solid />
      <main>
        <section className="bg-background px-5 pb-16 pt-32 md:px-8 md:pt-40 lg:pt-48">
          <Reveal className="mx-auto max-w-3xl text-center">
            <Kicker>{g.kicker}</Kicker>
            <h1 className="font-display text-4xl text-ink md:text-5xl">{g.title}</h1>
            <p className="mt-5 text-lg text-ink-2">{g.sub}</p>
          </Reveal>
        </section>
        {g.steps.map((s, i) => {
          const n = i + 1;
          const even = n % 2 === 0;
          return (
            <section key={n} className={cn("px-5 py-16 md:px-8 md:py-24", even ? "bg-card" : "bg-surface")}>
              <Reveal className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-16">
                <div className={cn("order-2", even ? "md:order-2" : "md:order-1")}>
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand/10">
                    <span className="font-display text-5xl text-brand md:text-6xl">{n}</span>
                  </div>
                  <h2 className="font-display text-3xl text-ink">{s.t}</h2>
                  <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">{s.d}</p>
                </div>
                <div className={cn("order-1", even ? "md:order-1" : "md:order-2")}>
                  {/* STEP {n} SCREENSHOT */}
                  <PhoneFrame id={`step-${n}`} label={g.placeholder} />
                </div>
              </Reveal>
            </section>
          );
        })}
        <section className="bg-navy px-5 py-20 md:px-8 md:py-28">
          <Reveal className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-16">
            <p className="order-2 font-display text-2xl leading-snug text-ice md:order-1 md:text-3xl">{g.staff}</p>
            <div className="order-1 md:order-2">
              {/* STAFF SCREENSHOT */}
              <PhoneFrame id="staff" label={g.placeholder} dark />
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
    </>
  );
}

function GuidePage() {
  return (
    <LanguageProvider>
      <Guide />
    </LanguageProvider>
  );
}
