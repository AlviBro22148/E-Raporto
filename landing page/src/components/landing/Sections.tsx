import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  AlertTriangle, BarChart3, Bell, Brain, Check, CheckCircle2, Copy, FileText, Gauge, Layers, ListChecks,
  MapPin, Network, RadioTower, SearchX, ShieldCheck, SlidersHorizontal, Split, UserPlus, Zap,
} from "lucide-react";
import { useI18n } from "@/i18n/LanguageProvider";
import { Card, Glow, IconBubble, Kicker, Reveal } from "./ui";

const stroke = { strokeWidth: 1.75 } as const;

function Head({ kicker, title, body, dark }: { kicker?: string; title: string; body?: string; dark?: boolean }) {
  return (
    <Reveal className="mx-auto mb-14 max-w-3xl text-center">
      {kicker && <Kicker dark={!!dark}>{kicker}</Kicker>}
      <h2 className={`font-display text-3xl leading-tight md:text-5xl ${dark ? "text-primary-foreground" : "text-ink"}`}>{title}</h2>
      {body && <p className={`mt-5 text-lg leading-relaxed ${dark ? "text-ice/80" : "text-ink-2"}`}>{body}</p>}
    </Reveal>
  );
}

export function Problem() {
  const { t } = useI18n();
  const icons = [<Split key="a" {...stroke} />, <SearchX key="b" {...stroke} />, <Copy key="c" {...stroke} />];
  return (
    <section id="problem" className="bg-surface py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <Head kicker={t.problem.kicker} title={t.problem.title} body={t.problem.body} />
        <div className="grid gap-6 md:grid-cols-3">
          {t.problem.cards.map((c, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <Card><IconBubble>{icons[i]}</IconBubble><h3 className="text-xl font-semibold text-ink">{c.t}</h3><p className="mt-2 leading-relaxed text-ink-2">{c.d}</p></Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function How() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const icons = [<UserPlus key="a" {...stroke} />, <MapPin key="b" {...stroke} />, <Brain key="c" {...stroke} />, <RadioTower key="d" {...stroke} />];
  return (
    <section id="how" className="bg-background py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <Head title={t.how.title} />
        <div className="relative">
          <svg aria-hidden className="absolute top-8 left-[12.5%] hidden h-2 w-[75%] md:block" preserveAspectRatio="none" viewBox="0 0 100 2">
            <motion.line x1="0" y1="1" x2="100" y2="1" stroke="var(--brand-light)" strokeWidth="2" strokeDasharray="3 2" vectorEffect="non-scaling-stroke"
              initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: "easeInOut" }} />
          </svg>
          <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
            {t.how.steps.map((s, i) => (
              <Reveal key={i} delay={i * 0.12}>
                <li className="text-center">
                  <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-navy text-ice shadow-lift">
                    {icons[i]}
                    <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-primary-foreground">{i + 1}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-ink">{s.t}</h3>
                  <p className="mt-2 leading-relaxed text-ink-2">{s.d}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function AIEngine() {
  const { t } = useI18n();
  const icons = [<Layers key="a" {...stroke} />, <Gauge key="b" {...stroke} />, <ShieldCheck key="c" {...stroke} />, <SlidersHorizontal key="d" {...stroke} />];
  return (
    <section id="ai" className="relative overflow-hidden bg-navy py-24 md:py-32">
      <Glow className="-top-32 right-[-10%] h-[500px] w-[500px]" />
      <Glow className="bottom-[-20%] left-[-10%] h-[420px] w-[420px] bg-brand/40" />
      <div className="relative mx-auto max-w-5xl px-5 md:px-8">
        <Head dark kicker={t.ai.kicker} title={t.ai.title} />
        <div className="grid gap-6 md:grid-cols-2">
          {t.ai.cards.map((c, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <Card dark><IconBubble dark>{icons[i]}</IconBubble><h3 className="text-xl font-semibold text-primary-foreground">{c.t}</h3><p className="mt-2 leading-relaxed text-ice/75">{c.d}</p></Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Duplicates() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <section className="bg-surface py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <Head title={t.dup.title} />
        <div ref={ref} className="grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-ink-3 uppercase">{t.dup.before}</p>
            <div className="relative h-[290px]">
              {[0, 1, 2, 3, 4].map((k) => (
                <motion.div key={k}
                  initial={false}
                  animate={inView && !reduce ? { y: [k * 58, k * 58, 116], opacity: [1, 1, k === 2 ? 1 : 0] } : { y: k * 58, opacity: 1 }}
                  transition={{ duration: 2.4, times: [0, 0.4, 1], delay: 0.3, repeat: reduce ? 0 : Infinity, repeatDelay: 1.5 }}
                  className="absolute inset-x-0 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-soft">
                  <span className="h-2 w-2 rounded-full bg-cat-roads" />
                  <span className="text-sm font-medium text-ink">{t.dup.report}</span>
                  <span className="ml-auto text-xs text-ink-3">#{1042 + k * 7}</span>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="hidden text-3xl text-brand-light md:block" aria-hidden>→</div>
          <Reveal>
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-ink-3 uppercase">{t.dup.after}</p>
            <div className="rounded-2xl border-2 border-brand-light/40 bg-card p-7 shadow-lift">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cat-roads/10 px-2.5 py-1 text-xs font-semibold text-cat-roads">
                <span className="h-1.5 w-1.5 rounded-full bg-cat-roads" />#1042
              </span>
              <h3 className="mt-3 text-xl font-semibold text-ink">{t.dup.ticket}</h3>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ice px-3 py-1.5 text-sm font-semibold text-brand"><CheckCircle2 className="h-4 w-4" />{t.dup.badge}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-cat-roads/10 px-3 py-1.5 text-sm font-semibold text-cat-roads"><AlertTriangle className="h-4 w-4" />{t.dup.priority}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Innovation() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden bg-navy-deep py-28 md:py-36">
      <Glow className="top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 bg-brand/40" />
      <div className="relative mx-auto max-w-6xl px-5 md:px-8">
        <Head dark kicker={t.innov.kicker} title={t.innov.title} body={t.innov.body} />
        <div className="relative mx-auto max-w-4xl">
          <div className="grid gap-4 md:grid-cols-3">
            {t.innov.cards.map((c, i) => (
              <Reveal key={i} delay={i * 0.1}>
                <div className="flex items-center gap-3 rounded-xl border border-ice/15 bg-ice/5 px-4 py-3.5">
                  <Zap className="h-4 w-4 text-cat-lighting" {...stroke} />
                  <span className="text-sm font-medium text-ice">{c}</span>
                </div>
              </Reveal>
            ))}
          </div>
          <svg aria-hidden className="mx-auto hidden h-20 w-full md:block" viewBox="0 0 300 60" preserveAspectRatio="none">
            {[50, 150, 250].map((x, i) => (
              <motion.path key={x} d={`M${x} 0 C ${x} 30, 150 30, 150 60`} fill="none" stroke="var(--brand-light)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.4 + i * 0.15 }} />
            ))}
          </svg>
          <div className="h-6 md:hidden" />
          <Reveal delay={0.6} className="mx-auto max-w-lg">
            <div className="rounded-2xl border border-brand-light/50 bg-gradient-to-br from-brand to-navy p-7 text-center shadow-glow">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ice px-3 py-1 text-xs font-bold tracking-wider text-navy"><Network className="h-3.5 w-3.5" />{t.innov.badge}</span>
              <p className="mt-4 font-display text-2xl text-primary-foreground">{t.innov.verdict}</p>
            </div>
          </Reveal>
          <Reveal delay={0.7}><p className="mx-auto mt-8 max-w-2xl text-center text-ice/70 italic">{t.innov.caption}</p></Reveal>
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  const { t } = useI18n();
  const icons = [<CheckCircle2 key="a" {...stroke} />, <Zap key="b" {...stroke} />, <Bell key="c" {...stroke} />, <FileText key="d" {...stroke} />];
  return (
    <section id="trust" className="bg-surface py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-5 md:px-8">
        <Head kicker={t.trust.kicker} title={t.trust.title} />
        <div className="grid gap-6 md:grid-cols-2">
          {t.trust.cards.map((c, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <Card><IconBubble>{icons[i]}</IconBubble><h3 className="text-xl font-semibold text-ink">{c.t}</h3><p className="mt-2 leading-relaxed text-ink-2">{c.d}</p></Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Municipality() {
  const { t } = useI18n();
  const colors = ["bg-cat-roads", "bg-cat-lighting", "bg-cat-water", "bg-cat-waste", "bg-cat-spaces"];
  const fIcons = [<BarChart3 key="a" {...stroke} />, <ListChecks key="b" {...stroke} />, <SlidersHorizontal key="c" {...stroke} />];
  return (
    <section id="municipality" className="relative overflow-hidden bg-navy py-24 md:py-32">
      <Glow className="top-0 left-[-10%] h-[500px] w-[500px]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 md:px-8 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-3xl leading-tight text-primary-foreground md:text-5xl">{t.muni.title}</h2>
          <ul className="mt-8 space-y-4">
            {t.muni.features.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-lg text-ice/90">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-light/25 text-ice">{fIcons[i]}</span>{f}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.15}>
          <ul className="overflow-hidden rounded-2xl border border-ice/10 bg-ice/5">
            {t.muni.depts.map((d, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-ice/10 px-6 py-5 last:border-0">
                <span className={`h-3 w-3 rounded-full ${colors[i]}`} />
                <span className="font-medium text-ice">{d}</span>
                <Check className="ml-auto h-4 w-4 text-ice/50" />
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(to); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (n: number) => {
      const p = Math.min((n - start) / 1600, 1);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, reduce]);
  return <span ref={ref}>{v.toLocaleString("en-US")}{suffix}</span>;
}

export function Stats() {
  const { t } = useI18n();
  return (
    <section className="border-y border-border bg-background py-14">
      <div className="mx-auto grid max-w-5xl gap-8 px-5 text-center sm:grid-cols-3">
        <div><p className="font-display text-4xl text-navy md:text-5xl"><Counter to={115000} suffix="+" /></p><p className="mt-1 text-ink-2">{t.stats[0]}</p></div>
        <div><p className="font-display text-4xl text-navy md:text-5xl"><Counter to={5} /></p><p className="mt-1 text-ink-2">{t.stats[1]}</p></div>
        <div><p className="font-display text-4xl text-navy md:text-5xl"><Counter to={24} />/<Counter to={7} /></p><p className="mt-1 text-ink-2">{t.stats[2]}</p></div>
      </div>
    </section>
  );
}
