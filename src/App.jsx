import React, { useState, useEffect } from "react";

const API_KEY = import.meta.env.VITE_ODDS_API_KEY;

const leagues = [
  { name: "瑞典超", key: "soccer_sweden_allsvenskan" },
  { name: "挪超", key: "soccer_norway_eliteserien" },
  { name: "MLS", key: "soccer_usa_mls" },
  { name: "巴甲", key: "soccer_brazil_campeonato" },
  { name: "英超", key: "soccer_epl" },
  { name: "西甲", key: "soccer_spain_la_liga" },
  { name: "意甲", key: "soccer_italy_serie_a" },
  { name: "德甲", key: "soccer_germany_bundesliga" },
];

export default function App() {
  const [matches, setMatches] = useState([]);
  const [records, setRecords] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [history, setHistory] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(leagues[0]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [onlyGood, setOnlyGood] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("");

  useEffect(() => {
    const savedRecords = localStorage.getItem("football_records");
    const savedSnapshots = localStorage.getItem("football_snapshots");
    const savedHistory = localStorage.getItem("football_history");

    if (savedRecords) setRecords(JSON.parse(savedRecords));
    if (savedSnapshots) setSnapshots(JSON.parse(savedSnapshots));
    if (savedHistory) setHistory(JSON.parse(savedHistory));
  }, []);

  useEffect(() => {
    let t1;
    let t2;

    if (autoRefresh) {
      t1 = setInterval(() => {
        fetchCurrentLeague();
        setCountdown(30);
      }, 30000);

      t2 = setInterval(() => {
        setCountdown((v) => (v <= 1 ? 30 : v - 1));
      }, 1000);
    }

    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [autoRefresh, selectedLeague, matches, snapshots]);

  function saveLocal(newRecords, newSnapshots, newHistory) {
    localStorage.setItem("football_records", JSON.stringify(newRecords));
    localStorage.setItem("football_snapshots", JSON.stringify(newSnapshots));
    localStorage.setItem("football_history", JSON.stringify(newHistory));
  }

  async function fetchCurrentLeague() {
    setLoading(true);
    const list = await fetchLeagueOdds(selectedLeague);
    updateMatches(list, selectedLeague.name);
    setLoading(false);
  }

  async function fetchAllLeagues() {
    setLoading(true);
    let all = [];

    for (const league of leagues) {
      const list = await fetchLeagueOdds(league);
      all = [...all, ...parseOdds(list, league.name)];
    }

    finishUpdate(all, "多联赛扫描");
    setLoading(false);
  }

  async function fetchLeagueOdds(league) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/odds/?apiKey=${API_KEY}&regions=eu&markets=totals&oddsFormat=decimal`;
      const res = await fetch(url);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function updateMatches(data, leagueName) {
    const parsed = parseOdds(data, leagueName);
    finishUpdate(parsed, leagueName);
  }

  function finishUpdate(parsed, mode) {
    const nextSnapshots = { ...snapshots };

    const withChange = parsed.map((m) => {
      const old = snapshots[m.id];
      const change = getChange(m, old);
      nextSnapshots[m.id] = {
        line: m.line,
        over: m.over,
        under: m.under,
      };
      return { ...m, ...change };
    });

    withChange.sort((a, b) => {
      if (b.hasChange !== a.hasChange) return Number(b.hasChange) - Number(a.hasChange);
      return b.score - a.score;
    });

    const nextRecords = saveRecommendations(withChange);
    const nextHistory = saveScanHistory(withChange, mode);

    setMatches(withChange);
    setSnapshots(nextSnapshots);
    setRecords(nextRecords);
    setHistory(nextHistory);
    setLastUpdate(new Date().toLocaleTimeString());

    saveLocal(nextRecords, nextSnapshots, nextHistory);
  }

  function parseOdds(data, leagueName) {
    return data.map((game) => {
      const bookmaker = game.bookmakers?.[0];
      const market = bookmaker?.markets?.find((m) => m.key === "totals");
      const outcomes = market?.outcomes || [];

      const over = outcomes.find((o) => o.name === "Over");
      const under = outcomes.find((o) => o.name === "Under");

      const line = Number(over?.point || under?.point || 0);
      const overPrice = Number(over?.price || 0);
      const underPrice = Number(under?.price || 0);

      const analysis = analyzeMatch(leagueName, line, overPrice, underPrice);

      return {
        id: `${leagueName}-${game.id}`,
        rawId: game.id,
        leagueKey: leagues.find((l) => l.name === leagueName)?.key,
        league: leagueName,
        match: `${game.home_team} vs ${game.away_team}`,
        home: game.home_team,
        away: game.away_team,
        time: formatTime(game.commence_time),
        line,
        over: overPrice,
        under: underPrice,
        ...analysis,
      };
    });
  }

  function analyzeMatch(league, line, over, under) {
    let score = 50;
    let direction = "观望";
    let result = "观望";
    let reason = "";

    if (!line || !over || !under) {
      return {
        direction: "观望",
        result: "无盘口",
        score: 50,
        reason: "暂未获取到完整大小球盘口",
      };
    }

    if (over < under) {
      direction = "大球";
      score += 20;
      reason = "大球赔率更低，市场偏向大球";
    } else if (under < over) {
      direction = "小球";
      score += 20;
      reason = "小球赔率更低，市场偏向小球";
    }

    if (["瑞典超", "挪超", "MLS", "德甲"].includes(league) && direction === "大球") {
      score += 8;
      reason += "，该联赛进攻属性较强";
    }

    if (["巴甲", "意甲"].includes(league) && direction === "小球") {
      score += 5;
      reason += "，该联赛节奏相对谨慎";
    }

    if (Math.abs(over - under) < 0.08) {
      score -= 8;
      reason += "，大小球赔率差距较小，方向不够明显";
    }

    if (league === "MLS") {
      score -= 3;
      reason += "，MLS后期波动大，注意风险";
    }

    if (score >= 80) result = "S级优质";
    else if (score >= 72) result = "优质";
    else if (score >= 62) result = "可打";
    else if (score >= 54) result = "观望";
    else result = "不碰";

    return { direction, result, score, reason };
  }

  function getChange(now, old) {
    if (!old) {
      return {
        hasChange: false,
        changeText: "首次获取，暂无历史对比",
      };
    }

    const messages = [];

    if (now.line > old.line) messages.push(`盘口升盘：${old.line} → ${now.line}，偏大增强`);
    if (now.line < old.line) messages.push(`盘口降盘：${old.line} → ${now.line}，偏小增强`);

    if (now.over && old.over) {
      const d = +(now.over - old.over).toFixed(2);
      if (d <= -0.05) messages.push(`大球赔率下降：${old.over} → ${now.over}`);
      if (d >= 0.05) messages.push(`大球赔率上升：${old.over} → ${now.over}`);
    }

    if (now.under && old.under) {
      const d = +(now.under - old.under).toFixed(2);
      if (d <= -0.05) messages.push(`小球赔率下降：${old.under} → ${now.under}`);
      if (d >= 0.05) messages.push(`小球赔率上升：${old.under} → ${now.under}`);
    }

    return {
      hasChange: messages.length > 0,
      changeText: messages.length ? messages.join("；") : "暂无明显异动",
    };
  }

  function saveRecommendations(list) {
    const oldMap = {};
    records.forEach((r) => {
      oldMap[r.id] = r;
    });

    list.forEach((m) => {
      if (["S级优质", "优质", "可打"].includes(m.result) && m.direction !== "观望") {
        if (!oldMap[m.id]) {
          oldMap[m.id] = {
            id: m.id,
            rawId: m.rawId,
            leagueKey: m.leagueKey,
            league: m.league,
            match: m.match,
            home: m.home,
            away: m.away,
            time: m.time,
            line: m.line,
            direction: m.direction,
            score: m.score,
            result: m.result,
            status: "待验证",
            finalScore: "",
            outcome: "",
            createdAt: new Date().toLocaleString(),
          };
        }
      }
    });

    return Object.values(oldMap).slice(-300);
  }

  function saveScanHistory(list, mode) {
    const h = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      mode,
      total: list.length,
      good: list.filter((m) => m.result.includes("优质")).length,
      changed: list.filter((m) => m.hasChange).length,
      top: list.slice(0, 5).map((m) => `${m.league}｜${m.match}｜${m.direction}｜${m.result}｜${m.score}分`),
    };

    return [h, ...history].slice(0, 10);
  }

  async function verifyResults() {
    setLoading(true);
    let nextRecords = [...records];

    for (const league of leagues) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${league.key}/scores/?apiKey=${API_KEY}&daysFrom=3`;
        const res = await fetch(url);
        const scores = await res.json();

        if (!Array.isArray(scores)) continue;

        nextRecords = nextRecords.map((r) => {
          if (r.leagueKey !== league.key || r.status !== "待验证") return r;

          const game = scores.find((s) => s.id === r.rawId);
          if (!game || !game.completed || !game.scores) return r;

          const homeScore = Number(game.scores.find((s) => s.name === r.home)?.score);
          const awayScore = Number(game.scores.find((s) => s.name === r.away)?.score);

          if (isNaN(homeScore) || isNaN(awayScore)) return r;

          const total = homeScore + awayScore;
          let outcome = "走水";

          if (r.direction === "大球") {
            if (total > r.line) outcome = "命中";
            else if (total < r.line) outcome = "未中";
          }

          if (r.direction === "小球") {
            if (total < r.line) outcome = "命中";
            else if (total > r.line) outcome = "未中";
          }

          return {
            ...r,
            status: "已完场",
            finalScore: `${homeScore}-${awayScore}`,
            totalGoals: total,
            outcome,
            verifiedAt: new Date().toLocaleString(),
          };
        });
      } catch (e) {
        console.log("赛果验证失败", league.name, e);
      }
    }

    setRecords(nextRecords);
    localStorage.setItem("football_records", JSON.stringify(nextRecords));
    setLoading(false);
    alert("赛果验证完成");
  }

  function clearAll() {
    setRecords([]);
    setHistory([]);
    setSnapshots({});
    localStorage.removeItem("football_records");
    localStorage.removeItem("football_history");
    localStorage.removeItem("football_snapshots");
  }

  function formatTime(time) {
    if (!time) return "-";
    return new Date(time).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const showMatches = matches
    .filter((m) => (onlyGood ? m.result.includes("优质") : true))
    .filter((m) => (onlyChanged ? m.hasChange : true));

  const settled = records.filter((r) => r.status === "已完场" && r.outcome !== "走水");
  const wins = settled.filter((r) => r.outcome === "命中").length;
  const losses = settled.filter((r) => r.outcome === "未中").length;
  const winRate = settled.length ? ((wins / settled.length) * 100).toFixed(1) : "0.0";

  return (
    <div style={pageStyle}>
      <h1>AI足球盘口实时监控系统</h1>

      <div style={controlCard}>
        <select value={selectedLeague.key} onChange={(e) => setSelectedLeague(leagues.find((l) => l.key === e.target.value))} style={selectStyle}>
          {leagues.map((l) => (
            <option key={l.key} value={l.key}>{l.name}</option>
          ))}
        </select>

        <button onClick={fetchCurrentLeague} style={buttonStyle}>{loading ? "获取中..." : "获取当前联赛"}</button>
        <button onClick={fetchAllLeagues} style={buttonStyle}>多联赛扫描</button>
        <button onClick={() => setAutoRefresh(!autoRefresh)} style={{ ...buttonStyle, background: autoRefresh ? "#ef4444" : "#22c55e" }}>
          {autoRefresh ? `自动刷新中(${countdown}s)` : "开启自动刷新"}
        </button>
        <button onClick={() => setOnlyGood(!onlyGood)} style={{ ...buttonStyle, background: onlyGood ? "#facc15" : "#334155" }}>
          {onlyGood ? "显示全部" : "只看优质"}
        </button>
        <button onClick={() => setOnlyChanged(!onlyChanged)} style={{ ...buttonStyle, background: onlyChanged ? "#f97316" : "#334155" }}>
          {onlyChanged ? "显示全部" : "只看异动"}
        </button>
        <button onClick={verifyResults} style={{ ...buttonStyle, background: "#6366f1" }}>赛果验证</button>
        <button onClick={clearAll} style={{ ...buttonStyle, background: "#64748b" }}>清空记录</button>
      </div>

      <p style={{ color: "#94a3b8" }}>当前显示：{showMatches.length} 场 {lastUpdate && `｜最后刷新：${lastUpdate}`}</p>

      <div style={statCard}>
        <h2>命中率统计</h2>
        <p>记录总数：{records.length}｜已验证：{settled.length}｜命中：{wins}｜未中：{losses}｜命中率：{winRate}%</p>
      </div>

      {history.length > 0 && (
        <div style={statCard}>
          <h2>扫描历史</h2>
          {history.map((h) => (
            <div key={h.id} style={historyItem}>
              <p>{h.time}｜{h.mode}｜总场数：{h.total}｜优质：{h.good}｜异动：{h.changed}</p>
              {h.top.map((t, i) => <p key={i} style={{ color: "#94a3b8" }}>TOP{i + 1}：{t}</p>)}
            </div>
          ))}
        </div>
      )}

      <div style={statCard}>
        <h2>推荐记录</h2>
        {records.slice().reverse().slice(0, 20).map((r) => (
          <div key={r.id} style={historyItem}>
            <p>{r.league}｜{r.match}｜推荐：{r.direction}{r.line}｜评级：{r.result}｜状态：{r.status}</p>
            {r.status === "已完场" && (
              <p style={{ color: r.outcome === "命中" ? "#22c55e" : r.outcome === "未中" ? "#ef4444" : "#facc15" }}>
                比分：{r.finalScore}｜总进球：{r.totalGoals}｜结果：{r.outcome}
              </p>
            )}
          </div>
        ))}
      </div>

      <div>
        {showMatches.map((m) => (
          <div key={m.id} style={{ ...cardStyle, border: m.hasChange ? "2px solid #f97316" : "1px solid transparent" }}>
            {m.hasChange && <div style={badgeStyle}>盘口异动</div>}
            <h2>{m.match}</h2>
            <p>开赛时间：{m.time}</p>
            <p>联赛：{m.league}</p>
            <p>大小球盘口：{m.line}</p>
            <p>大球赔率：{m.over}</p>
            <p>小球赔率：{m.under}</p>
            <h3>推荐方向：<span style={{ color: m.direction === "大球" ? "#ef4444" : m.direction === "小球" ? "#22c55e" : "#94a3b8" }}>{m.direction}</span></h3>
            <h3>系统评级：<span style={{ color: m.result.includes("优质") ? "#22c55e" : m.result === "可打" ? "#facc15" : "#ef4444" }}>{m.result}</span></h3>
            <p>评分：{m.score}</p>
            <p>分析理由：{m.reason}</p>
            <p style={{ color: m.hasChange ? "#f97316" : "#94a3b8" }}>异动追踪：{m.changeText}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const pageStyle = {
  background: "#111827",
  minHeight: "100vh",
  padding: 30,
  color: "white",
  fontFamily: "Arial",
  textAlign: "center",
};

const controlCard = {
  background: "#1f2937",
  padding: 20,
  borderRadius: 12,
};

const statCard = {
  background: "#0f172a",
  padding: 20,
  borderRadius: 12,
  marginTop: 20,
  border: "1px solid #334155",
};

const historyItem = {
  background: "#1f2937",
  padding: 12,
  borderRadius: 10,
  marginTop: 10,
};

const cardStyle = {
  background: "#1f2937",
  padding: 20,
  borderRadius: 12,
  marginTop: 20,
  position: "relative",
};

const badgeStyle = {
  position: "absolute",
  top: 12,
  right: 12,
  background: "#f97316",
  padding: "6px 12px",
  borderRadius: 999,
};

const selectStyle = {
  padding: "12px 18px",
  borderRadius: 8,
  marginRight: 10,
  fontSize: 16,
};

const buttonStyle = {
  background: "#22c55e",
  border: "none",
  padding: "12px 20px",
  color: "white",
  borderRadius: 8,
  cursor: "pointer",
  margin: 8,
  fontSize: 16,
};
