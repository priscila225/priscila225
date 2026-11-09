#!/usr/bin/env node
/**
 * Build commit-weighted language SVGs from ALL repos the viewer contributed to.
 * Output: profile/top-langs-light.svg, profile/top-langs-dark.svg
 * Never writes repo/org names into output files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "profile");
const TOKEN = process.env.STATS_TOKEN || process.env.GH_PROFILE_STATS_TOKEN;
if (!TOKEN) {
  console.error("Missing STATS_TOKEN / GH_PROFILE_STATS_TOKEN");
  process.exit(1);
}

const YEAR_CAP = 5;
const TOP_N = 6;
const GQL = "https://api.github.com/graphql";

const EXCLUDE = new Set(
  [
    "HTML",
    "CSS",
    "SCSS",
    "Sass",
    "Less",
    "Stylus",
    "PostCSS",
    "Makefile",
    "Dockerfile",
    "Batchfile",
    "Procfile",
    "Markdown",
    "MDX",
    "JSON",
    "JSON5",
    "JSONC",
    "JSON with Comments",
    "YAML",
    "TOML",
    "XML",
    "SVG",
    "Diff",
    "Text",
    "Ini",
    "Ignore List",
    "Git Attributes",
    "Git Config",
    "EditorConfig",
    "Properties",
    "CSV",
    "TSV",
    "AsciiDoc",
    "reStructuredText",
    "Jupyter Notebook",
    "Shell",
    "PowerShell",
    "PLpgSQL",
    "SQL",
    "GraphQL",
    "Protocol Buffer",
    "Thrift",
    "CMake",
    "QMake",
    "Ninja",
    "Nix",
    "Starlark",
    "Jinja",
    "Mustache",
    "Handlebars",
    "EJS",
    "Pug",
    "Liquid",
    "Twig",
    "Vue",
    "Svelte", // keep if she uses heavily; rare in her stack — leave included? Vue/Svelte are langs; keep
  ].filter((x) => !["Vue", "Svelte"].includes(x))
);
// Re-add Vue/Svelte as allowed (programming UI langs) — EXCLUDE already filtered them out above.

const COLOR_FALLBACK = {
  Kotlin: "#A97BFF",
  BrightScript: "#662D91",
  Brightscript: "#662D91",
  BrighterScript: "#66AABB",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Java: "#b07219",
  Swift: "#F05138",
  Python: "#3572A5",
  Go: "#00ADD8",
  C: "#555555",
  "C++": "#f34b7d",
  "Objective-C": "#438eff",
  "C#": "#7355dd",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Groovy: "#4298b8",
  Gradle: "#02303a",
  Dart: "#00B4AB",
  Rust: "#dea584",
  Scala: "#c22d40",
};

function normalizeLang(name) {
  if (!name) return null;
  if (name === "BrighterScript" || name === "Brightscript") return "BrightScript";
  return name;
}

async function gql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "priscila225-top-langs",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : res.statusText;
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

async function contributionYears() {
  const data = await gql(`query { viewer { contributionsCollection { contributionYears } } }`);
  return data.viewer.contributionsCollection.contributionYears;
}

async function contribsForYear(year) {
  const from = `${year}-01-01T00:00:00Z`;
  const data = await gql(
    `query($from: DateTime!) {
      viewer {
        contributionsCollection(from: $from) {
          commitContributionsByRepository(maxRepositories: 100) {
            contributions { totalCount }
            repository { nameWithOwner }
          }
          pullRequestContributionsByRepository(maxRepositories: 100) {
            contributions { totalCount }
            repository { nameWithOwner }
          }
        }
      }
    }`,
    { from }
  );
  return data.viewer.contributionsCollection;
}

async function fetchLanguages(repos) {
  // repos: [{owner, name, key}]
  const out = new Map(); // key -> [{name, size, color}]
  const chunkSize = 15;
  for (let i = 0; i < repos.length; i += chunkSize) {
    const chunk = repos.slice(i, i + chunkSize);
    const parts = chunk.map((r, idx) => {
      const alias = `r${idx}`;
      return `${alias}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) {
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }`;
    });
    const data = await gql(`query { ${parts.join("\n")} }`);
    chunk.forEach((r, idx) => {
      const node = data[`r${idx}`];
      if (!node || !node.languages) {
        out.set(r.key, []);
        return;
      }
      out.set(
        r.key,
        node.languages.edges.map((e) => ({
          name: e.node.name,
          size: e.size,
          color: e.node.color,
        }))
      );
    });
  }
  return out;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSvg(langs, theme) {
  // langs: [{name, pct, color}] pct is 0-100 number
  const dark = theme === "dark";
  const bg = dark ? "#00000000" : "#fffefe";
  const title = dark ? "#58a6ff" : "#2f80ed";
  const text = dark ? "#c9d1d9" : "#434d58";
  const width = 300;
  const height = 165;
  const barY = 40;
  const barW = 250;
  const barX = 25;
  const barH = 8;

  let x = 0;
  const segments = langs.map((l) => {
    const w = (l.pct / 100) * barW;
    const seg = { ...l, x, w };
    x += w;
    return seg;
  });

  // 2-column legend, 3 rows
  const colW = 150;
  const legendStartY = 60;
  let legend = "";
  langs.forEach((l, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const tx = col * colW;
    const ty = row * 25;
    const delay = 450 + row * 150;
    legend += `
      <g transform="translate(${tx}, ${ty})">
        <g class="stagger" style="animation-delay: ${delay}ms">
          <circle cx="5" cy="6" r="5" fill="${l.color}" />
          <text data-testid="lang-name" x="15" y="10" class="lang-name">${escapeXml(l.name)} ${l.pct.toFixed(2)}%</text>
        </g>
      </g>`;
  });

  const barRects = segments
    .map(
      (s) => `
        <rect
          mask="url(#rect-mask)"
          data-testid="lang-progress"
          x="${s.x.toFixed(2)}"
          y="0"
          width="${Math.max(s.w, 0).toFixed(2)}"
          height="${barH}"
          fill="${s.color}"
        />`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-labelledby="descId"
>
  <title id="titleId">Most Used Languages</title>
  <desc id="descId">Most used languages by commit-weighted share</desc>
  <style>
    .header {
      font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif;
      fill: ${title};
      animation: fadeInAnimation 0.8s ease-in-out forwards;
    }
    @supports(-moz-appearance: auto) {
      .header { font-size: 15.5px; }
    }
    .lang-name {
      font: 400 11px "Segoe UI", Ubuntu, Sans-Serif;
      fill: ${text};
    }
    .stagger {
      opacity: 0;
      animation: fadeInAnimation 0.3s ease-in-out forwards;
    }
    @keyframes fadeInAnimation {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  </style>
  <rect data-testid="card-bg" x="0.5" y="0.5" rx="4.5" height="99%" stroke="${dark ? "#00000000" : "#e4e2e2"}" width="${width - 1}" fill="${bg}" stroke-opacity="1"/>
  <g data-testid="card-title" transform="translate(25, 35)">
    <text x="0" y="0" class="header">Most Used Languages</text>
  </g>
  <g transform="translate(${barX}, ${barY})">
    <mask id="rect-mask">
      <rect x="0" y="0" width="${barW}" height="${barH}" fill="white" rx="5"/>
    </mask>
    ${barRects}
  </g>
  <g transform="translate(25, ${legendStartY})">
    <g transform="translate(0, 0)">${legend}
    </g>
  </g>
</svg>
`;
}

async function main() {
  const yearsAll = await contributionYears();
  const years = yearsAll.slice(0, YEAR_CAP);
  console.log(`Years: ${years.join(", ")}`);

  /** @type {Map<string, {commits:number, prs:number}>} */
  const weights = new Map();
  for (const year of years) {
    const c = await contribsForYear(year);
    for (const row of c.commitContributionsByRepository || []) {
      const key = row.repository?.nameWithOwner;
      if (!key) continue;
      const cur = weights.get(key) || { commits: 0, prs: 0 };
      cur.commits += row.contributions?.totalCount || 0;
      weights.set(key, cur);
    }
    for (const row of c.pullRequestContributionsByRepository || []) {
      const key = row.repository?.nameWithOwner;
      if (!key) continue;
      const cur = weights.get(key) || { commits: 0, prs: 0 };
      cur.prs += row.contributions?.totalCount || 0;
      weights.set(key, cur);
    }
  }

  const repoList = [];
  // Cap/dampen so one old outlier year cannot drown current work.
  // Raw commit counts still drive order; soft cap keeps hiring-facing langs honest.
  const RAW_CAP = 150;
  for (const [key, w] of weights) {
    const raw = w.commits > 0 ? w.commits : w.prs > 0 ? w.prs : 0;
    if (raw <= 0) continue;
    const weight = Math.min(raw, RAW_CAP);
    const [owner, name] = key.split("/");
    if (!owner || !name) continue;
    repoList.push({ key, owner, name, weight });
  }
  console.log(`Repos with activity: ${repoList.length}`);

  const langMap = await fetchLanguages(repoList);

  /** @type {Map<string, {score:number, color:string}>} */
  const scores = new Map();
  for (const r of repoList) {
    const langs = langMap.get(r.key) || [];
    const totalBytes = langs.reduce((s, l) => s + (l.size || 0), 0);
    if (totalBytes <= 0) continue;
    for (const l of langs) {
      const norm = normalizeLang(l.name);
      if (!norm || EXCLUDE.has(l.name) || EXCLUDE.has(norm)) continue;
      const share = (l.size || 0) / totalBytes;
      const add = r.weight * share;
      const prev = scores.get(norm) || { score: 0, color: null };
      prev.score += add;
      if (!prev.color) {
        prev.color =
          (norm === "BrightScript" ? COLOR_FALLBACK.BrightScript : null) ||
          l.color ||
          COLOR_FALLBACK[norm] ||
          "#8b949e";
      }
      scores.set(norm, prev);
    }
  }

  const ranked = [...scores.entries()]
    .map(([name, v]) => ({ name, score: v.score, color: v.color }))
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, TOP_N);
  const sum = top.reduce((s, x) => s + x.score, 0) || 1;
  const langs = top.map((t) => ({
    name: t.name,
    color: t.color || COLOR_FALLBACK[t.name] || "#8b949e",
    pct: (t.score / sum) * 100,
  }));

  // Sanity log: language names + pct only (no repos)
  console.log("Top languages:");
  for (const l of langs) {
    console.log(`  ${l.name}: ${l.pct.toFixed(2)}%`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const light = renderSvg(langs, "light");
  const dark = renderSvg(langs, "dark");
  // Safety: refuse to write if any contributed repo or owner name slipped in
  const secretNames = new Set();
  for (const r of repoList) {
    secretNames.add(r.owner.toLowerCase());
    secretNames.add(r.name.toLowerCase());
  }
  for (const [label, content] of [
    ["light", light],
    ["dark", dark],
  ]) {
    const lower = content.toLowerCase();
    for (const n of secretNames) {
      if (n.length > 3 && lower.includes(n) && n !== "priscila225") {
        throw new Error(`Refusing to write ${label} SVG: repo or owner name detected`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "top-langs-light.svg"), light);
  fs.writeFileSync(path.join(OUT_DIR, "top-langs-dark.svg"), dark);
  console.log("Wrote profile/top-langs-light.svg and profile/top-langs-dark.svg");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
