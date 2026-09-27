import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

export function Glow({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pointer-events-none absolute rounded-full bg-brand-light/30 blur-3xl", className)} />;
}

export function Kicker({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={cn("mb-4 text-xs font-semibold tracking-[0.18em]", dark ? "text-ice/80" : "text-brand")}>{children}</p>;
}

export function Card({ children, dark, className }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "h-full rounded-2xl p-7 transition-all duration-200 ease-out hover:-translate-y-1",
        dark
          ? "border border-ice/10 bg-ice/5 hover:bg-ice/10 hover:shadow-glow"
          : "border border-border bg-card shadow-soft hover:shadow-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function IconBubble({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={cn("mb-5 flex h-12 w-12 items-center justify-center rounded-full", dark ? "bg-brand-light/25 text-ice" : "bg-ice text-brand")}>
      {children}
    </div>
  );
}
