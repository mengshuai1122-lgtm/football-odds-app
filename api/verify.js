import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_KEY = process.env.ODDS_API_KEY;

const leagues = [
  "soccer_brazil_campeonato",
  "soccer_usa_mls",
  "soccer_sweden_allsvenskan",
  "soccer_norway_eliteserien",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga"
];

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function teamMatch(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);

  return (
    x === y ||
    x.includes(y) ||
    y.includes(x)
  );
}

export default async function handler(req, res) {
  try {
    const { data: records } = await supabase
      .from("matches")
      .select("*")
      .eq("status", "待验证");

    let updated = 0;

    for (const league of leagues) {
      const response = await fetch(
        `https://api.the-odds-api.com/v4/sports/${league}/scores/?apiKey=${API_KEY}&daysFrom=3`
      );

      const scores = await response.json();

      if (!Array.isArray(scores)) continue;

      for (const r of records) {
        const game = scores.find(
          (s) =>
            teamMatch(s.home_team, r.home) &&
            teamMatch(s.away_team, r.away)
        );

        if (!game) continue;

        if (!game.completed) continue;

        if (!game.scores) continue;

        const homeScore = Number(
          game.scores.find((s) => teamMatch(s.name, r.home))
            ?.score
        );

        const awayScore = Number(
          game.scores.find((s) => teamMatch(s.name, r.away))
            ?.score
        );

        if (isNaN(homeScore) || isNaN(awayScore))
          continue;

        const total = homeScore + awayScore;

        let outcome = "走水";
        let profit = 0;
        let roi = 0;

        if (r.direction === "大球") {
          if (total > r.line) outcome = "命中";
          if (total < r.line) outcome = "未中";
        }

        if (r.direction === "小球") {
          if (total < r.line) outcome = "命中";
          if (total > r.line) outcome = "未中";
        }

        if (outcome === "命中") {
          profit = Number(
            (Number(r.bet_odds || 1.85) - 1).toFixed(2)
          );

          roi = Number(
            (profit * 100).toFixed(1)
          );
        }

        if (outcome === "未中") {
          profit = -1;
          roi = -100;
        }

        await supabase
          .from("matches")
          .update({
            status: "已完场",
            final_score: `${homeScore}-${awayScore}`,
            total_goals: total,
            outcome,
            profit,
            roi,
            verified_at: new Date().toISOString()
          })
          .eq("id", r.id);

        updated++;
      }
    }

    return res.status(200).json({
      success: true,
      updated
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}