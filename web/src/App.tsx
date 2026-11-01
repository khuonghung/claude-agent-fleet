import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nContext, LANGUAGES, type Lang, pickLanguage, translator } from "./i18n";
import { launched } from "./lib";
import { BurnUp, ChartCard, Funnel, Pulse, TokenBurn } from "./parts/Charts";
import { Comms } from "./parts/Comms";
import { Drawer, type Open } from "./parts/Drawer";
import { Feed } from "./parts/Feed";
import { Fleet } from "./parts/Fleet";
import { Flow } from "./parts/Flow";
import { Header, type Theme } from "./parts/Header";
import { Kpis } from "./parts/Kpis";
import { Members, MissionPlan, OrgChart } from "./parts/Org";
import { Attention, Lineup } from "./parts/Overview";
import { Branches, Infra, Notices, Reports } from "./parts/Side";
import { Threads } from "./parts/Threads";
import { Slider } from "./ui/Controls";
import { Palette, Toasts } from "./ui/Live";
import { useFleet, useNow } from "./useFleet";

const TABS = ["overview", "org", "fleet", "tickets", "code", "reports"] as const;
type Tab = (typeof TABS)[number];

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window keeps the choice for this visit only.
  }
};

const readTheme = (): Theme => {
  const t = stored("fleet-theme");
  return t === "dark" || t === "light" ? t : "system";
};
const tabFromHash = (): Tab => TABS.find((t) => `#${t}` === location.hash) ?? "overview";

export function App() {
  const { state, link, lastAt } = useFleet();
  const now = useNow();
  const [open, setOpen] = useState<Open>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [palette, setPalette] = useState(false);
  const [chosen, setChosen] = useState<string | null>(() => stored("fleet-lang"));
  const lang = pickLanguage(chosen, state?.mission.language, navigator.language);
  const i18n = useMemo(() => ({ lang, locale: LANGUAGES.find((l) => l.id === lang)?.locale ?? "en-GB", t: translator(lang) }), [lang]);
  const { t } = i18n;

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    store("fleet-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (state) document.title = `${state.mission.name} · Agent Fleet`;
  }, [state?.mission.name]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: string) => {
    const to = TABS.find((x) => x === next) ?? "overview";
    history.replaceState(null, "", `#${to}`);
    setTab(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const onLang = (next: Lang) => {
    store("fleet-lang", next);
    setChosen(next);
  };
  const close = useCallback(() => setOpen(null), []);
  const onAgent = useCallback((id: string) => setOpen({ kind: "agent", id }), []);
  const onTicket = useCallback((id: string) => setOpen({ kind: "doc", doc: "ticket", name: id }), []);
  const onDoc = useCallback((doc: string, name: string) => setOpen({ kind: "doc", doc, name }), []);

  if (!state) {
    return (
      <I18nContext.Provider value={i18n}>
        <div className="boot">
          <svg className="hd-mark" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="14" />
            <path d="M7 19 L13 13 L17 17 L25 9" />
          </svg>
          <p>{link === "lost" ? t("app.lost") : t("app.connecting")}</p>
        </div>
      </I18nContext.Provider>
    );
  }

  const tickets = state.board?.tickets ?? [];
  const counts: Partial<Record<Tab, string>> = {
    org: `${state.agents.length}`,
    tickets: `${tickets.length}`,
    code: `${state.git?.branches.reduce((n, b) => n + b.commits.filter((c) => !c.merge).length, 0) ?? 0}`,
    reports: `${state.board?.reports.length ?? 0}`,
  };

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <Header mission={state.mission} now={now} link={link} lastAt={lastAt} theme={theme} onTheme={setTheme} onLang={onLang} onSearch={() => setPalette(true)}>
          <Slider kind="tabs" label="tabs" value={tab} onChange={go} items={TABS.map((id) => ({ id, label: t(`tab.${id}`), badge: counts[id] ? <small>{counts[id]}</small> : undefined }))} />
        </Header>

        <main className="main" key={tab}>
          {!launched(state) && (
            <p className="banner" role="status">
              {t("app.notLaunched")}
            </p>
          )}

          {tab === "overview" && (
            <>
              <Lineup s={state} now={now} onAgent={onAgent} />
              <Kpis s={state} now={now} />
              <div className="layout">
                <div className="col-main">
                  <ChartCard title={t("ch.burn")} note={t("ch.burnNote")}>
                    <BurnUp s={state} now={now} />
                  </ChartCard>
                  <ChartCard title={t("ch.pulse")} note={t("ch.pulseNote")}>
                    <Pulse s={state} now={now} onAgent={onAgent} />
                  </ChartCard>
                  <div className="pair">
                    <ChartCard title={t("ch.tokens")} note={t("ch.tokensNote")}>
                      <TokenBurn s={state} now={now} />
                    </ChartCard>
                    <ChartCard title={t("ch.funnel")} note={t("ch.funnelNote")}>
                      <Funnel s={state} />
                    </ChartCard>
                  </div>
                </div>
                <div className="col-side">
                  <Attention s={state} now={now} onTicket={onTicket} onAgent={onAgent} />
                  {(state.board?.threads ?? []).some((x) => x.status === "open") && <Threads s={state} now={now} onAgent={onAgent} onDoc={onDoc} />}
                  <Feed s={state} onTicket={onTicket} onAgent={onAgent} />
                </div>
              </div>
            </>
          )}

          {tab === "org" && (
            <>
              <OrgChart s={state} now={now} onAgent={onAgent} />
              <div className="pair pair-wide">
                <Members s={state} now={now} onAgent={onAgent} />
                <MissionPlan s={state} now={now} />
              </div>
            </>
          )}

          {tab === "fleet" && (
            <div className="layout">
              <div className="col-main">
                <Fleet s={state} now={now} onAgent={onAgent} />
              </div>
              <div className="col-side">
                <Threads s={state} now={now} onAgent={onAgent} onDoc={onDoc} />
                <Comms s={state} />
                <Feed s={state} onTicket={onTicket} onAgent={onAgent} />
              </div>
            </div>
          )}

          {tab === "tickets" && (
            <>
              <Flow s={state} now={now} onTicket={onTicket} />
              <div className="pair">
                <ChartCard title={t("ch.funnel")} note={t("ch.funnelNote")}>
                  <Funnel s={state} />
                </ChartCard>
                <ChartCard title={t("ch.burn")} note={t("ch.burnNote")}>
                  <BurnUp s={state} now={now} />
                </ChartCard>
              </div>
            </>
          )}

          {tab === "code" && (
            <div className="pair">
              <Branches s={state} now={now} />
              <div className="stack">
                <Infra s={state} />
                <Comms s={state} />
              </div>
            </div>
          )}

          {tab === "reports" && (
            <div className="pair">
              <Reports s={state} now={now} onDoc={onDoc} />
              <Notices s={state} />
            </div>
          )}
        </main>
        <Drawer s={state} open={open} now={now} onClose={close} onTicket={onTicket} onAgent={onAgent} onDoc={onDoc} />
        <Toasts s={state} now={now} onTicket={onTicket} onAgent={onAgent} />
        <Palette s={state} open={palette} onOpen={setPalette} tabs={TABS.map((id) => ({ id, label: t(`tab.${id}`) }))} onTab={go} onAgent={onAgent} onTicket={onTicket} />
      </div>
    </I18nContext.Provider>
  );
}
