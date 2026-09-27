import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, CheckCircle2, MapPin } from "lucide-react";
import pothole from "@/assets/pothole.png.asset.json";
import { useI18n } from "@/i18n/LanguageProvider";
import { Glow, Kicker } from "./ui";
import { cn } from "@/lib/utils";

function Phone() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % 4), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div role="img" aria-label={t.hero.phoneAlt} className="relative mx-auto aspect-[9/18] w-[260px] rounded-[3rem] border border-ice/25 bg-navy-deep p-[10px] shadow-glow md:w-[280px]">
      <span aria-hidden className="absolute top-24 -left-[3px] h-8 w-[3px] rounded-l bg-navy-deep" />
      <span aria-hidden className="absolute top-36 -left-[3px] h-12 w-[3px] rounded-l bg-navy-deep" />
      <span aria-hidden className="absolute top-52 -left-[3px] h-12 w-[3px] rounded-l bg-navy-deep" />
      <span aria-hidden className="absolute top-40 -right-[3px] h-16 w-[3px] rounded-r bg-navy-deep" />
      <div className="relative flex h-full flex-col overflow-hidden rounded-[2.4rem] bg-surface">
        <div className="relative flex h-8 shrink-0 items-center justify-between px-6 text-[10px] font-semibold text-ink">
          <span>9:41</span>
          <div aria-hidden className="absolute top-0 left-1/2 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-navy-deep" />
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-[2px] border border-ink" /></span>
        </div>
        <div className="flex flex-1 flex-col justify-between p-4 pt-3 pb-4">
          <img src={pothole.url} alt={t.hero.phoneTitle} className="h-40 w-full rounded-xl object-cover" loading="eager" />
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cat-roads/10 px-2.5 py-1 text-[11px] font-semibold text-cat-roads">
              <span className="h-1.5 w-1.5 rounded-full bg-cat-roads" />{t.hero.phoneDept}
            </span>
            <p className="mt-2 font-semibold text-ink">{t.hero.phoneTitle}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-3"><MapPin className="h-3.5 w-3.5" />{t.hero.phoneLoc}</p>
          </div>
          <div className="h-9">
            <AnimatePresence mode="wait">
              <motion.div key={i}
                initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
                className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold", i === 3 ? "bg-cat-waste/15 text-cat-waste" : "bg-ice text-brand")}>
                {i === 3 ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />}
                {t.status[i]}
              </motion.div>
            </AnimatePresence>
          </div>
          <ol className="space-y-3 border-t border-border pt-4">
            {t.status.map((s, k) => (
              <li key={k} className="flex items-center gap-2.5 text-xs">
                <span className={cn("h-2.5 w-2.5 rounded-full transition-colors duration-300", k <= i ? "bg-brand" : "bg-ink-3/25")} />
                <span className={k <= i ? "font-medium text-ink" : "text-ink-3"}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div aria-hidden className="mx-auto mb-2 h-1 w-24 shrink-0 rounded-full bg-ink/80" />
      </div>
    </div>
  );
}

export function Hero() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 800], [0, reduce ? 0 : 160]);
  const y2 = useTransform(scrollY, [0, 800], [0, reduce ? 0 : -100]);
  return (
    <section id="home" className="relative flex min-h-screen items-center overflow-hidden bg-navy pt-28 pb-16 md:pt-32">
      <motion.div style={{ y: y1 }} className="absolute -top-40 -left-40 h-[520px] w-[520px]"><Glow className="inset-0 bg-brand/50" /></motion.div>
      <motion.div style={{ y: y2 }} className="absolute right-0 bottom-0 h-[600px] w-[600px]"><Glow className="inset-0" /></motion.div>
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 md:px-8 lg:grid-cols-[1.2fr_1fr]">
        <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <Kicker dark>{t.hero.kicker}</Kicker>
          <h1 className="font-display text-4xl leading-[1.1] text-primary-foreground md:text-6xl">{t.hero.title}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ice/80">{t.hero.sub}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#contact" className="inline-flex items-center gap-2 rounded-xl bg-brand-light px-6 py-3.5 font-semibold text-primary-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand">
              {t.hero.primary}<ArrowRight className="h-4 w-4" />
            </a>
            <a href="#municipality" className="inline-flex items-center rounded-xl border border-ice/30 px-6 py-3.5 font-semibold text-ice transition-colors hover:bg-ice/10">
              {t.hero.secondary}
            </a>
          </div>
        </motion.div>
        <motion.div initial={reduce ? false : { opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="relative">
          <Glow className="inset-10 bg-brand-light/40" />
          <Phone />
        </motion.div>
      </div>
    </section>
  );
}
