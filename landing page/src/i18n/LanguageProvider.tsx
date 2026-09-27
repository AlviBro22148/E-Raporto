import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, type Dict, type Lang } from "./translations";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: Dict };
const LanguageContext = createContext<Ctx | null>(null);
const KEY = "e-raporto-lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("al");
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === "al" || saved === "en") setLangState(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "al" ? "sq" : "en";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(KEY, l);
  };
  return <LanguageContext.Provider value={{ lang, setLang, t: translations[lang] }}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const c = useContext(LanguageContext);
  if (!c) throw new Error("useI18n must be used inside LanguageProvider");
  return c;
}
