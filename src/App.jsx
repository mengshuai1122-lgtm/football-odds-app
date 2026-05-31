import React, { useState, useEffect, useRef } from "react";

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
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState(leagues[0]);
  const [onlyGood, setOnlyGood] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [lastUpdate, setLastUpdate] = useState("");

  const previousMapRef = useRef({});

  useEffect(() => {
    let refreshTimer;
    let countdownTimer;

    if (autoRefresh) {
      refreshTimer = setInterval(() => {
        fetchMatches();
        setCountdown(30);
      }, 30000);

      countdownTimer = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
      }, 1000);
    }

    return () => {
      clearInterval(refreshTimer);
      clearInterval(countdownTimer);
    };
  }, [autoRefresh, selectedLeague, matches]);

  function saveHistory(list, mode) {
    const record = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      mode,
      total: list.length,
      good: list.filter((m) => m.result.includes("优质")).length,
      changed: list.filter((m) => m.hasChange).length,
      top: list.slice(0, 3).map((m) => ({
        match: m.match,
        league: m.league,
        result: m.result,
        direction: m.direction,
        score: m.score,
      })),
    };

    setHistory((prev) => [record, ...prev].slice(0, 10));
  }

  async function fetchMatches() {
    setLoading(true);

    try {
      const data = await fetchLeague(selectedLeague);
      const parsedMatches = parseGames(data, selectedLeague.name);

      previousMapRef.current = buildPreviousMap(matches);

      const withChanges = parsedMatches.map((m) =>
        attachChangeInfo(m, previousMapRef.current[m.id])
      );

      withChanges.sort((a, b) => {
        if (b.hasChange !== a.hasChange) return b.hasChange - a.hasChange;
        return b.score - a.score;
      });

      setMatches(withChanges);
      saveHistory(withChanges, selectedLeague.name);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (error) {
      console.error(error);
      alert("接口获取失败，请检查网络或API Key");
    }

    setLoading(false);
  }

  async function fetchAllLeagues() {
    setLoading(true);

    try {
      previousMapRef.current = buildPreviousMap(matches);

      let allMatches = [];

      for (const league of leagues) {
        try {
          const data = await fetchLeague(league);
          const parsed = parseGames(data, league.name);
          allMatches = [...allMatches, ...parsed];
        } catch (e) {
          console.log(`${league.name} 获取失败`, e);
        }
      }

      const withChanges = allMatches.map((m) =>
        attachChangeInfo(m, previousMapRef.current[m.id])
      );

      withChanges.sort((a, b) => {
        if (b.hasChange !== a.hasChange) return b.hasChange - a.hasChange;
        return b.score - a.score;
      });

      setMatches(withChanges);
      saveHistory(withChanges, "多联赛扫描");
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (error) {
      console.error(error);
      alert("多联赛获取失败，请检查网络或API Key");
    }

    setLoading(false);
  }

  async function fetchLeague(league) {
    const url =
      `https://api.the-odds-api.com/v4/sports/${league.key}/odds/?apiKey=${API_KEY}&regions=eu&markets=totals&oddsFormat=decimal`;

    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      console.log(`${league.name} 返回异常：`, data);
      return [];
    }

    return data;
  }

  function parseGames(data, leagueName) {
    return data.map((game) => {
      const bookmaker = game.bookmakers?.[0];
      const market = bookmaker?.markets?.find((m) => m.key === "totals");
      const outcomes = market?.outcomes || [];

      const over = outcomes.find((o) => o.name === "Over");
      const under = outcomes.find((o) => o.name === "Under");

      const line = over?.point || under?.point || "-";
      const overPrice = over?.price || "-";
      const underPrice = under?.price || "-";

      const analysis = analyzeMatch(leagueName, overPrice, underPrice);

      return {
        id: `${leagueName}-${game.id}`,
        match: `${game.home_team} vs ${game.away_team}`,
        league: leagueName,
        time: formatTime(game.commence_time),
        line,
        over: overPrice,
        under: underPrice,
        ...analysis,
      };
    });
  }

  function attachChangeInfo(current, previous) {
    if (!previous) {
      return {
        ...current,
        hasChange: false,
        changeText: "首次获取，暂无历史对比",
      };
    }

    const currentLine = Number(current.line);
    const previousLine = Number(previous.line);
    const currentOver = Number(current.over);
    const previousOver = Number(previous.over);
    const currentUnder = Number(current.under);
    const previousUnder = Number(previous.under);

    let hasChange = false;
    let messages = [];

    if (isValidNumber(currentLine) && isValidNumber(previousLine)) {
      if (currentLine > previousLine) {
        hasChange = true;
        messages.push(`盘口升盘：${previous.line} → ${current.line}`);
      }
      if (currentLine < previousLine) {
        hasChange = true;
        messages.push(`盘口降盘：${previous.line} → ${current.line}`);
      }
    }

    if (isValidNumber(currentOver) && isValidNumber(previousOver)) {
      const diff = +(currentOver - previousOver).toFixed(2);
      if (diff <= -0.05) {
        hasChange = true;
        messages.push(`大球赔率下降：${previous.over} → ${current.over}`);
      }
      if (diff >= 0.05) {
        hasChange = true;
        messages.push(`大球赔率上升：${previous.over} → ${current.over}`);
      }
    }

    if (isValidNumber(currentUnder) && isValidNumber(previousUnder)) {
      const diff = +(currentUnder - previousUnder).toFixed(2);
      if (diff <= -0.05) {
        hasChange = true;
        messages.push(`小球赔率下降：${previous.under} → ${current.under}`);
      }
      if (diff >= 0.05) {
        hasChange = true;
        messages.push(`小球赔率上升：${previous.under} → ${current.under}`);
      }
    }

    return {
      ...current,
      hasChange,
      changeText: messages.length ? messages.join("；") : "暂无明显异动",
    };
  }

  function buildPreviousMap(list) {
    const map = {};
    list.forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }

  function analyzeMatch(league, over, under) {
    let score = 50;
    let direction = "观望";
    let reason = "";

    const overNum = Number(over);
    const underNum = Number(under);

    if (!overNum || !underNum) {
      return {
        direction: "观望",
        score: 50,
        result: "无盘口",
        reason: "暂未获取到完整大小球赔率",
      };
    }

    if (underNum < overNum) {
      direction = "小球";
      score += 20;
      reason = "小球赔率更低，市场偏向小球";
    }

    if (overNum < underNum) {
      direction = "大球";
      score += 20;
      reason = "大球赔率更低，市场偏向大球";
    }

    if (["巴甲", "英超", "意甲"].includes(league) && direction === "小球") {
      score += 5;
      reason += "，该联赛节奏相对谨慎";
    }

    if (["挪超", "瑞典超", "MLS", "德甲"].includes(league) && direction === "大球") {
      score += 8;
      reason += "，该联赛进攻属性较强";
    }

    if (league === "MLS") {
      reason += "，MLS后期波动较大，注意风险";
      score -= 3;
    }

    if (Math.abs(overNum - underNum) < 0.08) {
      score -= 8;
      reason += "，大小球赔率差距较小，方向不够明显";
    }

    let result = "观望";

    if (score >= 80) result = "S级优质";
    else if (score >= 72) result = "优质";
    else if (score >= 62) result = "可打";
    else if (score >= 54) result = "观望";
    else result = "不碰";

    return { direction, score, result, reason };
  }

  function isValidNumber(value) {
    return typeof value === "number" && !isNaN(value);
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

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: 40 }}>AI足球盘口实时监控系统</h1>

      <div style={controlCard}>
        <select
          value={selectedLeague.key}
          onChange={(e) => {
            const league = leagues.find((l) => l.key === e.target.value);
            setSelectedLeague(league);
          }}
          style={selectStyle}
        >
          {leagues.map((league) => (
            <option key={league.key} value={league.key}>
              {league.name}
            </option>
          ))}
        </select>

        <button onClick={fetchMatches} style={buttonStyle}>
          {loading ? "获取中..." : "获取当前联赛"}
        </button>

        <button onClick={fetchAllLeagues} style={buttonStyle}>
          {loading ? "扫描中..." : "多联赛扫描"}
        </button>

        <button
          onClick={() => {
            setAutoRefresh(!autoRefresh);
            setCountdown(30);
          }}
          style={{
            ...buttonStyle,
            background: autoRefresh ? "#ef4444" : "#22c55e",
          }}
        >
          {autoRefresh ? `自动刷新中 (${countdown}s)` : "开启自动刷新"}
        </button>

        <button
          onClick={() => setOnlyGood(!onlyGood)}
          style={{ ...buttonStyle, background: onlyGood ? "#facc15" : "#334155" }}
        >
          {onlyGood ? "显示全部" : "只看优质"}
        </button>

        <button
          onClick={() => setOnlyChanged(!onlyChanged)}
          style={{ ...buttonStyle, background: onlyChanged ? "#f97316" : "#334155" }}
        >
          {onlyChanged ? "显示全部" : "只看异动"}
        </button>

        <button
          onClick={() => setHistory([])}
          style={{ ...buttonStyle, background: "#64748b" }}
        >
          清空历史
        </button>
      </div>

      <p style={{ color: "#94a3b8" }}>
        当前显示：{showMatches.length} 场
        {lastUpdate && `｜最后刷新：${lastUpdate}`}
      </p>

      {history.length > 0 && (
        <div style={historyCard}>
          <h2>历史记录</h2>
          {history.map((h) => (
            <div key={h.id} style={historyItem}>
              <p>
                {h.time}｜{h.mode}｜总场数：{h.total}｜优质：{h.good}｜异动：{h.changed}
              </p>
              {h.top.map((m, index) => (
                <p key={index} style={{ color: "#94a3b8" }}>
                  TOP{index + 1}：{m.league}｜{m.match}｜{m.direction}｜{m.result}｜{m.score}分
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 30 }}>
        {showMatches.map((item) => (
          <div
            key={item.id}
            style={{
              ...cardStyle,
              border: item.hasChange ? "2px solid #f97316" : "1px solid transparent",
            }}
          >
            {item.hasChange && <div style={changeBadge}>盘口异动</div>}

            <h2>{item.match}</h2>
            <p>开赛时间：{item.time}</p>
            <p>联赛：{item.league}</p>
            <p>大小球盘口：{item.line}</p>
            <p>大球赔率：{item.over}</p>
            <p>小球赔率：{item.under}</p>

            <h3>
              推荐方向：
              <span style={{ color: item.direction === "小球" ? "#22c55e" : item.direction === "大球" ? "#ef4444" : "#94a3b8" }}>
                {item.direction}
              </span>
            </h3>

            <h3>
              系统评级：
              <span style={{ color: item.result.includes("优质") ? "#22c55e" : item.result === "可打" ? "#facc15" : "#ef4444" }}>
                {item.result}
              </span>
            </h3>

            <p>评分：{item.score}</p>
            <p>分析理由：{item.reason}</p>
            <p style={{ color: item.hasChange ? "#f97316" : "#94a3b8" }}>
              异动追踪：{item.changeText}
            </p>
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
  marginTop: 20,
};

const historyCard = {
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

const changeBadge = {
  position: "absolute",
  top: 12,
  right: 12,
  background: "#f97316",
  color: "white",
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 14,
};

const selectStyle = {
  padding: "12px 18px",
  borderRadius: 8,
  border: "none",
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