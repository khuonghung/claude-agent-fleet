import type { ReactNode } from "react";
import { LANGUAGES, type Lang, useI18n } from "../i18n";
import { clock, duration, endOf, startOf } from "../lib";
import type { Mission } from "../types";
import { Dropdown } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { Logo } from "../ui/Logo";
import type { Link } from "../useFleet";

export type Theme = "system" | "dark" | "light";

interface HeaderProps {
  mission: Mission;
  now: number;
  link: Link;
  lastAt: number;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onLang: (lang: Lang) => void;
  onSearch: () => void;
  children?: ReactNode;
}

export function Header({ mission, now, link, lastAt, theme, onTheme, onLang, onSearch, children }: HeaderProps) {
  const { t, lang, locale } = useI18n();
  const start = startOf(mission);
  const end = endOf(mission);
  const span = Math.max(1, end - start);
  const pos = Math.min(1, Math.max(0, (now - start) / span));
  const phase = mission.phases.find((p) => now >= Date.parse(p.from) && now < Date.parse(p.to));
  const stale = link === "live" && now - lastAt > 20_000;
  const left = now < start ? t("hd.before", { time: duration(start - now) }) : now >= end ? t("hd.over") : t("hd.left", { time: duration(end - now), phase: phase?.name ?? "" });
  const state = link === "live" ? (stale ? "stale" : "live") : link;

  return (
    <header className="hd">
      <div className="hd-brand">
        <Logo className="hd-mark" />
        <div className="hd-names">
          <div className="hd-title">Agent Fleet</div>
          <div className="hd-sub">{mission.name}</div>
        </div>
      </div>

      <div className="hd-timeline" role="img" aria-label={t("hd.progress", { pct: Math.round(pos * 100) })}>
        <div className="tl-track">
          {mission.phases.map((p) => {
            const a = (Date.parse(p.from) - start) / span;
            const b = (Date.parse(p.to) - start) / span;
            const past = now >= Date.parse(p.to);
            return (
              <div key={p.name + p.from} className={`tl-phase${p === phase ? " is-current" : ""}${past ? " is-past" : ""}`} style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} title={`${p.name} · ${clock(p.from, locale)}–${clock(p.to, locale)}`}>
                <span>{p.name}</span>
                <small>{clock(p.from, locale)}</small>
              </div>
            );
          })}
          <div className="tl-fill" style={{ width: `${pos * 100}%` }} />
          <div className="tl-needle" style={{ left: `${pos * 100}%` }} />
        </div>
      </div>

      <div className="hd-clock">
        <div className="hd-now">{clock(now, locale, true)}</div>
        <div className="hd-left">{left}</div>
      </div>

      <div className={`hd-link is-${state}`} aria-live="polite">
        <i />
        {state === "live" ? t("hd.live") : state === "stale" ? t("hd.waiting") : state === "connecting" ? t("hd.connecting") : t("hd.lost")}
      </div>
      <div className="hd-tools">
        <button type="button" className="hd-search" onClick={onSearch} aria-label={t("hd.search")}>
          <Icon name="search" />
          <span>{t("hd.search")}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <Dropdown value={lang} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label, hint: l.id.toUpperCase() }))} onChange={onLang} label={t("hd.language")} icon="globe" />
        <Dropdown
          value={theme}
          options={[
            { id: "system", label: t("theme.system") },
            { id: "light", label: t("theme.light") },
            { id: "dark", label: t("theme.dark") },
          ]}
          onChange={onTheme}
          label={t("hd.theme")}
          icon={theme === "dark" ? "moon" : theme === "light" ? "sun" : "auto"}
        />
      </div>
      {children}
    </header>
  );
}
