import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nContext, LANGUAGES, type Lang, pickLanguage, translator } from "./i18n";
import { launched } from "./lib";
import { BurnUp, ChartCard, Funnel, Pulse, TokenBurn } from "./parts/Charts";
import { Channel } from "./parts/Channel";
import { Comms } from "./parts/Comms";
import { Drawer, type Open } from "./parts/Drawer";
import { Feed } from "./parts/Feed";
import { Flow } from "./parts/Flow";
import { Header, type Theme } from "./parts/Header";
import { Kpis } from "./parts/Kpis";
import { LooksContext, useLooks } from "./parts/Mascot";
import { MissionPlan, Team } from "./parts/Org";
import { Attention, Lineup } from "./parts/Overview";
import { BranchList, CodeKpis, CommitTimeline, Hotspots, IntegrationRound, Preflight } from "./parts/Code";
import { Decisions, MemberScores, Risks, Scorecard, TicketTable } from "./parts/Report";
import { Notices, Reports } from "./parts/Side";
import { Threads } from "./parts/Threads";
import { Slider } from "./ui/Controls";
import { Palette, Toasts } from "./ui/Live";
import { Logo } from "./ui/Logo";
import type { AgentDef } from "./types";
import { useFleet, useNow } from "./useFleet";

const TABS = ["overview", "fleet", "tickets", "code", "reports"] as const;
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
const NO_AGENTS: AgentDef[] = [];
// The org chart was a tab of its own: an old #org link opens the team, where it now lives.
const tabFromHash = (): Tab => (location.hash === "#org" ? "fleet" : (TABS.find((t) => `#${t}` === location.hash) ?? "overview"));

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
  // One look per member for the whole page: members who share a role get told apart the same way everywhere.
  const looks = useLooks(state?.agents ?? NO_AGENTS);

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
          <Logo className="hd-mark" />
          <p>{link === "lost" ? t("app.lost") : t("app.connecting")}</p>
        </div>
      </I18nContext.Provider>
    );
  }

  const tickets = state.board?.tickets ?? [];
  const counts: Partial<Record<Tab, string>> = {
    fleet: `${state.agents.length}`,
    tickets: `${tickets.length}`,
    // The members' own commits: the integration branch holds the same commits again.
    code: `${state.git?.branches.filter((b) => b.branch !== state.git?.integration).reduce((n, b) => n + b.commits.filter((c) => !c.merge).length, 0) ?? 0}`,
    reports: `${state.board?.reports.length ?? 0}`,
  };

  return (
    <I18nContext.Provider value={i18n}>
      <LooksContext.Provider value={looks}>
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
                    {(state.board?.channel?.posts.length ?? 0) > 0 && <Channel s={state} now={now} onAgent={onAgent} onTicket={onTicket} onDoc={onDoc} />}
                    {(state.board?.threads ?? []).some((x) => x.status === "open") && <Threads s={state} now={now} onAgent={onAgent} onDoc={onDoc} />}
                    <Feed s={state} onTicket={onTicket} onAgent={onAgent} />
                  </div>
                </div>
              </>
            )}

            {tab === "fleet" && (
              <div className="layout">
                <div className="col-main">
                  <Team s={state} now={now} onAgent={onAgent} />
                </div>
                <div className="col-side">
                  <MissionPlan s={state} now={now} />
                  {state.board?.channel && <Channel s={state} now={now} onAgent={onAgent} onTicket={onTicket} onDoc={onDoc} />}
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
              <>
                <CodeKpis s={state} />
                <div className="pair pair-wide">
                  <IntegrationRound s={state} now={now} onTicket={onTicket} />
                  <Preflight s={state} now={now} />
                </div>
                <ChartCard title={t("cd.timeline")} note={t("cd.timelineNote")} wide>
                  <CommitTimeline s={state} now={now} onAgent={onAgent} />
                </ChartCard>
                <div className="pair">
                  <BranchList s={state} now={now} onTicket={onTicket} />
                  <Hotspots s={state} onAgent={onAgent} />
                </div>
              </>
            )}

            {tab === "reports" && (
              <>
                <Scorecard s={state} now={now} onDoc={onDoc} />
                <MemberScores s={state} now={now} onAgent={onAgent} onDoc={onDoc} />
                <TicketTable s={state} now={now} onTicket={onTicket} />
                <div className="pair">
                  <Risks s={state} onTicket={onTicket} />
                  <Decisions s={state} now={now} onDoc={onDoc} />
                </div>
                <div className="pair">
                  <Reports s={state} now={now} onDoc={onDoc} />
                  <Notices s={state} />
                </div>
              </>
            )}
          </main>
          <Drawer s={state} open={open} now={now} onClose={close} onTicket={onTicket} onAgent={onAgent} onDoc={onDoc} />
          <Toasts s={state} now={now} onTicket={onTicket} onAgent={onAgent} />
          <Palette s={state} open={palette} onOpen={setPalette} tabs={TABS.map((id) => ({ id, label: t(`tab.${id}`) }))} onTab={go} onAgent={onAgent} onTicket={onTicket} />
        </div>
      </LooksContext.Provider>
    </I18nContext.Provider>
  );
}
