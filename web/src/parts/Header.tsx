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
      <div className="hd-bar">
        <div className="hd-brand">
          <Logo className="hd-mark" />
          <div className="hd-names">
            <span className="hd-title">Agent Fleet</span>
            <span className="hd-sep" aria-hidden="true">/</span>
            <span className="hd-sub" title={mission.name}>
              {mission.name}
            </span>
          </div>
        </div>

        <div className="hd-status">
          <span className={`hd-link is-${state}`} aria-live="polite">
            <i />
            {state === "live" ? t("hd.live") : state === "stale" ? t("hd.waiting") : state === "connecting" ? t("hd.connecting") : t("hd.lost")}
          </span>
          <span className="hd-clock">
            <span className="hd-now">{clock(now, locale, true)}</span>
            <span className="hd-left">{left}</span>
          </span>
        </div>

        <div className="hd-tools">
          <button type="button" className="hd-search" onClick={onSearch} aria-label={t("hd.search")}>
            <Icon name="search" />
            <span>{t("hd.search")}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <Dropdown value={lang} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label, hint: l.id.toUpperCase() }))} onChange={onLang} label={t("hd.language")} icon="globe" compact />
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
            compact
          />
        </div>
      </div>

      {/* The mission's phases, each as long as it lasts: done, the one under way (filled as far as it has gone), and
          those to come. A short phase drops its time, then its name, which stay in its tooltip. */}
      <div className="hd-phases" role="img" aria-label={t("hd.progress", { pct: Math.round(pos * 100) })}>
        {mission.phases.map((p) => {
          const from = Date.parse(p.from);
          const to = Date.parse(p.to);
          const past = now >= to;
          const current = p === phase;
          const done = current ? Math.min(1, Math.max(0, (now - from) / Math.max(1, to - from))) : past ? 1 : 0;
          return (
            <div
              key={p.name + p.from}
              className={`ph${current ? " is-current" : ""}${past ? " is-past" : ""}`}
              style={{ flexGrow: Math.max(1, to - from) }}
              title={`${p.name} · ${clock(p.from, locale)}–${clock(p.to, locale)}`}
            >
              {current && <i className="ph-fill" style={{ width: `${done * 100}%` }} />}
              <span className="ph-name">{p.name}</span>
              <small className="ph-time">
                {clock(p.from, locale)}–{clock(p.to, locale)}
              </small>
            </div>
          );
        })}
      </div>
      {children}
    </header>
  );
}
