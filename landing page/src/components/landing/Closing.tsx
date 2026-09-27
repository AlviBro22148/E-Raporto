import { useState } from "react";
import { z } from "zod";
import { Apple, Mail, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo-cropped.png.asset.json";
import { useI18n } from "@/i18n/LanguageProvider";
import { Glow, Reveal } from "./ui";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  message: z.string().trim().min(1).max(2000),
});

export function Closing() {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err" | "invalid">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) return setState("invalid");
    setState("busy");
    const { error } = await supabase.from("contact_messages").insert(parsed.data);
    if (error) return setState("err");
    setState("ok");
    setForm({ name: "", email: "", message: "" });
  }

  const input = "w-full rounded-xl border border-ice/20 bg-ice/5 px-4 py-3 text-ice placeholder:text-ice/50 focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40";
  return (
    <section id="contact" className="relative overflow-hidden bg-navy py-24 md:py-32">
      <Glow className="top-[-20%] right-[-10%] h-[600px] w-[600px]" />
      <Glow className="bottom-[-30%] left-[-10%] h-[500px] w-[500px] bg-brand/40" />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 md:px-8 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-4xl leading-tight text-primary-foreground md:text-5xl">{t.cta.title}</h2>
          <p className="mt-8 font-semibold text-ice">{t.cta.download}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {[{ i: <Apple className="h-7 w-7" />, a: t.cta.appStore, b: t.cta.appStoreName }, { i: <Play className="h-6 w-6" />, a: t.cta.play, b: t.cta.playName }].map((s) => (
              <a key={s.b} href="#contact" className="flex items-center gap-3 rounded-xl border border-ice/25 bg-navy-deep px-5 py-2.5 text-ice transition-all hover:-translate-y-0.5 hover:border-ice/50">
                {s.i}<span className="text-left leading-tight"><span className="block text-[11px] text-ice/70">{s.a}</span><span className="text-lg font-semibold">{s.b}</span></span>
              </a>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.15}>
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-ice/10 bg-ice/5 p-7 backdrop-blur" noValidate>
            <h3 className="text-xl font-semibold text-primary-foreground">{t.cta.formTitle}</h3>
            <label className="block"><span className="sr-only">{t.cta.name}</span>
              <input className={input} placeholder={t.cta.name} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="sr-only">{t.cta.email}</span>
              <input type="email" className={input} placeholder={t.cta.email} value={form.email} maxLength={255} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block"><span className="sr-only">{t.cta.message}</span>
              <textarea rows={4} className={input} placeholder={t.cta.message} value={form.message} maxLength={2000} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            {(state === "ok" || state === "err" || state === "invalid") && (
              <p role="status" className="text-sm text-ice">{state === "ok" ? t.cta.ok : state === "err" ? t.cta.err : t.cta.invalid}</p>
            )}
            <button disabled={state === "busy"} className="w-full rounded-xl bg-brand-light px-6 py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-brand disabled:opacity-60">
              {state === "busy" ? t.cta.sending : t.cta.send}
            </button>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-ice/10 bg-navy-deep py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 text-center md:flex-row md:px-8 md:text-left">
        <div className="flex items-center gap-3">
          <img src={logo.url} alt="E-Raporto" className="h-10 w-10 object-contain" />
          <div><p className="font-display text-lg text-ice">E-Raporto</p><p className="text-sm text-ice/70">{t.footer.tagline}</p></div>
        </div>
        <div className="text-sm text-ice/70">
          <a href="mailto:info@e-raporto.al" className="inline-flex items-center gap-1.5 hover:text-ice"><Mail className="h-4 w-4" />info@e-raporto.al</a>
          <p className="mt-1">© {new Date().getFullYear()} E-Raporto · Bashkia Elbasan. {t.footer.rights}</p>
        </div>
      </div>
    </footer>
  );
}
