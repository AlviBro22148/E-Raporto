import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import logo from "@/assets/logo-cropped.png.asset.json";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export function Nav({ solid = false }: { solid?: boolean }) {
  const { t, lang, setLang } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > window.innerHeight * 0.8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const anchor = (id: string) => (solid ? `/#${id}` : `#${id}`);
  const links: [string, string][] = [
    ["home", t.nav.home], ["problem", t.nav.problem], ["ai", t.nav.ai],
    ["trust", t.nav.trust], ["municipality", t.nav.municipality], ["contact", t.nav.contact],
  ];
  const linkCls = "text-sm text-ice/80 transition-colors hover:text-ice";
  const mobileCls = "block rounded-lg px-3 py-2 text-ice/90 hover:bg-ice/10";
  const toggle = (
    <div role="group" aria-label={t.langLabel} className="flex rounded-full border border-ice/25 p-0.5 text-xs font-semibold">
      {(["al", "en"] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className={cn("rounded-full px-3 py-1 uppercase transition-colors", lang === l ? "bg-ice text-navy" : "text-ice/80 hover:text-ice")}>
          {l}
        </button>
      ))}
    </div>
  );
  const guideLink = (cls: string) => (
    <Link to="/how-it-works" onClick={() => setOpen(false)} className={cls} activeProps={{ className: "text-ice font-semibold" }}>{t.nav.how}</Link>
  );
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-all duration-300", solid || scrolled || open ? "bg-navy/90 shadow-lg backdrop-blur-md" : "bg-transparent")}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:h-20 lg:h-28 md:px-8">
        <a href={anchor("home")} className="flex items-center gap-3">
          <img src={logo.url} alt="E-Raporto" className="h-11 w-auto shrink-0 object-contain md:h-14 lg:h-20" />
          <span className="font-display text-xl text-ice lg:text-2xl">E-Raporto</span>
        </a>
        <ul className="hidden items-center gap-6 lg:flex">
          {links.slice(0, 2).map(([id, label]) => (
            <li key={id}><a href={anchor(id)} className={linkCls}>{label}</a></li>
          ))}
          <li>{guideLink(linkCls)}</li>
          {links.slice(2).map(([id, label]) => (
            <li key={id}><a href={anchor(id)} className={linkCls}>{label}</a></li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          {toggle}
          <button className="text-ice lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </nav>
      {open && (
        <ul className="space-y-1 px-5 pb-5 lg:hidden">
          {links.slice(0, 2).map(([id, label]) => (
            <li key={id}><a href={anchor(id)} onClick={() => setOpen(false)} className={mobileCls}>{label}</a></li>
          ))}
          <li>{guideLink(mobileCls)}</li>
          {links.slice(2).map(([id, label]) => (
            <li key={id}><a href={anchor(id)} onClick={() => setOpen(false)} className={mobileCls}>{label}</a></li>
          ))}
        </ul>
      )}
    </header>
  );
}
