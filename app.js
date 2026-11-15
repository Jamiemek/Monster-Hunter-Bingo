const $ = (id) => document.getElementById(id);

const STATE_KEY = "mh-bingo-v1";
const ROSTER_KEY = "mh-bingo-roster-v1";

let state = {
  game: "world",
  rank: "H",
  diff: "normal",
  size: 5,
  free: true,
  varPct: {},
  noExp: {},
  seed: "",
  n: 5,
  cells: [],
  marks: [],
};

let view = "menu";
let wizStep = 1;
let rerollArmed = false;
let resetArmed = false;
let edGame = "world";

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (saved && GAMES[saved.game] && Array.isArray(saved.cells)) Object.assign(state, saved);
  } catch (e) {}
}

function boardGame() {
  return state.boardGame || state.game;
}

function boardLabel() {
  return state.boardLabel || GAMES[boardGame()].label;
}

function setBackdrop(game = state.game) {
  const root = document.documentElement;
  root.dataset.theme = game;
  for (const [name, colour] of Object.entries(THEMES[game])) root.style.setProperty("--" + name, colour);
  root.style.setProperty("--scene", `url("img/bg-${game}.webp")`);
}

// seeded random, so a board code always gives the same board

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newSeed() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let seed = "";
  for (let i = 0; i < 6; i++) seed += chars[Math.floor(Math.random() * chars.length)];
  return seed;
}

// board generation

function varPct(key) {
  const pct = Number((state.varPct || {})[key]) || 0;
  return Math.max(0, Math.min(50, pct));
}

function poolRanks() {
  const pools = GAMES[state.game].pools;
  return (pools && pools[state.rank]) || state.rank;
}

function pool() {
  const ranks = [...poolRanks()];
  return GAMES[state.game].monsters.filter((m) => {
    if (m[4]) return false;
    if (m[3] && !varPct(m[3])) return false;
    return ranks.some((r) => m[1].includes(r));
  });
}

function poolText() {
  const g = GAMES[state.game];
  return `${pool().length} monsters in the pool at ${g.ranks[state.rank]} Rank.`;
}

function starRows(game, m, ranks) {
  const stars = STARS[game];
  const afflicted = m[3] === "AF";
  const fits = (row) => ranks.includes(row[0]) && Boolean(row[3]) === afflicted;
  const listed = stars.at[m[0]] || (m[3] && stars.at[m[0].replace(VARIANT_RE, "")]) || [];
  const rows = listed.map((i) => stars.rows[i]).filter(fits);
  if (rows.length) return rows;

  // no star data at this rank, so go by threat
  const target = (m[2] - 1) / 4;
  const options = stars.rows.filter((row) => fits(row) && m[1].includes(row[0]));
  if (!options.length) return [];
  options.sort((a, b) => Math.abs(a[2] - target) - Math.abs(b[2] - target));
  return [options[0]];
}

function variantCounts(monsters, total) {
  const counts = {};
  for (const m of monsters) {
    if (m[3]) counts[m[3]] = (counts[m[3]] || 0) + 1;
  }
  for (const key in counts) {
    const share = Math.max(1, Math.round((total * varPct(key)) / 100));
    counts[key] = Math.min(counts[key], share);
  }
  const sum = () => Object.values(counts).reduce((a, b) => a + b, 0);
  while (sum() > total) {
    const biggest = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
    counts[biggest]--;
  }
  return counts;
}

function generate(seed) {
  const monsters = pool();
  const slots = (n) => n * n - (state.free && n % 2 ? 1 : 0);
  const fillable = (n) => {
    const counts = variantCounts(monsters, slots(n));
    const variants = Object.values(counts).reduce((a, b) => a + b, 0);
    return monsters.filter((m) => !m[3]).length + variants;
  };

  let n = state.size;
  while (n > 3 && fillable(n) < slots(n)) n--;
  const note =
    n === state.size
      ? ""
      : `Not enough monsters at this rank for the size you picked, so the board is ${n}×${n}.`;

  const percents = Object.keys(VARIANTS).map(varPct).join(",");
  const rand = rng(hash([seed, state.game, state.rank, state.diff, n, state.free, percents].join("|")));

  const weights = DIFFS[state.diff].w;
  const weightAt = (difficulty) => {
    const x = Math.max(0, Math.min(1, difficulty)) * 4;
    const i = Math.floor(x);
    return weights[i] + (weights[Math.min(4, i + 1)] - weights[i]) * (x - i);
  };
  const zenithBoard = state.game === "frontier" && state.rank === "Z";
  const ranks = poolRanks();

  const ranked = monsters
    .map((m) => {
      const rows = starRows(state.game, m, ranks);
      let weight = rows.length ? Math.max(...rows.map((row) => weightAt(row[2]))) : weights[m[2] - 1];
      if (zenithBoard && m[1] === "Z") weight *= 3;
      return { m, rows, score: Math.pow(rand(), 1 / weight) };
    })
    .sort((a, b) => b.score - a.score);

  const total = slots(n);
  const counts = variantCounts(monsters, total);
  const picked = [];
  for (const entry of ranked) {
    const key = entry.m[3];
    if (key && counts[key] > 0) {
      counts[key]--;
      picked.push(entry);
    }
  }
  const normal = ranked.filter((entry) => !entry.m[3]);
  picked.push(...normal.slice(0, total - picked.length));

  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }

  const cells = picked.map(({ m, rows }) => {
    let star = "";
    if (rows.length) {
      const rowWeights = rows.map((row) => weightAt(row[2]));
      let roll = rand() * rowWeights.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < rows.length - 1 && (roll -= rowWeights[i]) > 0) i++;
      star = rows[i][1];
    }
    return { name: m[0], star };
  });
  if (state.free && n % 2) cells.splice((n * n - 1) / 2, 0, { name: "Free", free: true });

  const g = GAMES[state.game];
  state.seed = seed;
  state.n = n;
  state.boardGame = state.game;
  state.boardLabel = `${g.label}, ${g.ranks[state.rank]} Rank, ${DIFFS[state.diff].label}`;
  state.cells = cells;
  state.marks = cells.map((c) => Boolean(c.free));

  $("notice").textContent = note;
  $("seed").value = seed;
  save();
  renderBoard();
  if (view === "board") setBackdrop(state.boardGame);
}

// wizard

function segmented(id, options, current, onPick) {
  const el = $(id);
  el.innerHTML = "";
  for (const [value, label] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(value === current));
    b.addEventListener("click", () => onPick(value));
    el.appendChild(b);
  }
}

function variantSlider(key) {
  const row = document.createElement("label");
  row.className = "vrow";
  row.htmlFor = "var-" + key;

  const name = document.createElement("span");
  name.className = "vname";
  name.textContent = VARIANTS[key] + " monsters";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "var-" + key;
  slider.min = 0;
  slider.max = 50;
  slider.step = 5;
  slider.value = varPct(key);

  const out = document.createElement("output");
  out.htmlFor = slider.id;
  const show = () => {
    const pct = Number(slider.value);
    out.textContent = pct ? `${pct}% of the board` : "None";
    slider.setAttribute("aria-valuetext", out.textContent);
  };
  slider.addEventListener("input", () => {
    state.varPct = { ...state.varPct, [key]: Number(slider.value) };
    show();
    $("pool").textContent = poolText();
  });
  show();

  row.append(name, slider, out);
  return row;
}

function renderControls() {
  const g = GAMES[state.game];
  const baseOnly = g.expansion && state.noExp[state.game];
  const ranks = Object.entries(g.ranks).filter(([key]) => !(baseOnly && g.expansion.ranks.includes(key)));
  if (!ranks.some(([key]) => key === state.rank)) state.rank = ranks[ranks.length - 1][0];

  $("expField").hidden = !g.expansion;
  $("exp").checked = !baseOnly;
  $("expLab").textContent = g.expansion ? g.expansion.label : "";
  if (view === "wizard") setBackdrop();
  for (const card of document.querySelectorAll(".gamecard")) {
    card.setAttribute("aria-pressed", String(card.dataset.game === state.game));
  }

  const pick = (field) => (value) => {
    state[field] = value;
    renderControls();
  };
  segmented("rank", ranks, state.rank, pick("rank"));
  segmented(
    "diff",
    Object.entries(DIFFS).map(([key, d]) => [key, d.label]),
    state.diff,
    pick("diff"),
  );
  segmented(
    "size",
    SIZES.map((s) => [s, `${s}×${s}`]),
    state.size,
    pick("size"),
  );

  const keys = Object.keys(VARIANTS).filter((key) =>
    g.monsters.some((m) => m[3] === key && m[1].includes(state.rank)),
  );
  $("varField").hidden = !keys.length;
  $("variants").replaceChildren(...keys.map(variantSlider));

  $("free").checked = state.free;
  $("free").disabled = state.size % 2 === 0;
  $("pool").textContent = poolText();
}

const STEP_TITLES = ["Choose a game", "Rank and monsters", "Difficulty and board"];

function setStep(n) {
  wizStep = n;
  for (const el of document.querySelectorAll(".step")) el.hidden = Number(el.dataset.step) !== n;
  $("stepNo").textContent = `Step ${n} of 3`;
  $("stepTitle").textContent = STEP_TITLES[n - 1];
  $("wNext").hidden = n === 3;
  $("generate").hidden = n !== 3;
}

// board

function iconFor(game, name) {
  const set = ICONS[game];
  let i = set.names.indexOf(name);
  if (i < 0) i = set.names.indexOf(name.replace(VARIANT_RE, ""));
  return i < 0 ? null : { ...set, i };
}

function starInk(game, name) {
  const key = Object.keys(VARIANTS).find((k) => name.startsWith(VARIANTS[k] + " "));
  return (key && STAR_INK[game] && STAR_INK[game][key]) || "";
}

function isHyper(name) {
  return name.startsWith(VARIANTS.HY + " ");
}

function renderTile(cell, i) {
  const game = boardGame();
  const h = hash(state.seed + ":" + i);
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile p" + (h % 3);
  tile.title = cell.star ? `${cell.name}, ${cell.star}` : cell.name;
  tile.style.setProperty("--tilt", (((h >> 3) % 7) - 3) * 0.22 + "deg");
  tile.style.setProperty("--rot", -(5 + ((h >> 7) % 9)) + "deg");
  tile.style.setProperty("--bx", ((h >> 5) % 300) + "px");
  tile.style.setProperty("--by", ((h >> 11) % 300) + "px");
  tile.setAttribute("aria-pressed", String(Boolean(state.marks[i])));

  if (cell.free) {
    tile.classList.add("free");
    const paw = document.createElement("span");
    paw.className = "paw";
    tile.appendChild(paw);
  } else if (VARIANT_RE.test(cell.name)) {
    tile.classList.add("var");
  }

  const icon = iconFor(game, cell.name);
  if (icon) {
    const img = document.createElement("span");
    img.className = "icon";
    const col = icon.i % icon.cols;
    const row = Math.floor(icon.i / icon.cols);
    img.style.backgroundImage = `url("${icon.sheet}")`;
    img.style.backgroundSize = `${icon.cols * 100}% ${icon.rows * 100}%`;
    img.style.backgroundPosition = `${(col / (icon.cols - 1)) * 100}% ${(row / (icon.rows - 1)) * 100}%`;
    if (game === "rise") img.classList.add("ink");
    if (game === "gu" || game === "frontier") img.classList.add("px");
    if (isHyper(cell.name)) img.classList.add("hyper");
    tile.appendChild(img);
    tile.classList.add("has-icon");
    if ((NAMED_ICONS[game] || []).includes(cell.name)) tile.classList.add("named");
  }

  if (cell.star) {
    const star = document.createElement("span");
    star.className = "star";
    star.textContent = cell.star;
    star.style.color = starInk(game, cell.name);
    tile.appendChild(star);
  }

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = cell.name;
  const longestWord = Math.max(...cell.name.split(/[ -]/).map((w) => w.length));
  if (longestWord > 10) name.classList.add("long");
  tile.appendChild(name);

  if (!cell.free) {
    tile.addEventListener("click", () => {
      state.marks[i] = !state.marks[i];
      save();
      updateMarks();
    });
  }
  return tile;
}

function renderBoard() {
  const board = $("board");
  board.style.setProperty("--n", state.n);
  board.replaceChildren(...state.cells.map(renderTile));
  $("boardTitle").textContent = boardLabel();
  $("boardCode").textContent = "Code " + state.seed;
  updateMarks();
}

function boardLines(n) {
  const index = [...Array(n).keys()];
  const lines = [];
  for (const r of index) lines.push(index.map((c) => r * n + c));
  for (const c of index) lines.push(index.map((r) => r * n + c));
  lines.push(index.map((i) => i * n + i));
  lines.push(index.map((i) => i * n + (n - 1 - i)));
  return lines;
}

function boardTiles() {
  return $("board").querySelectorAll(":scope > .tile");
}

// a thread is pinned across each finished line
let threadLines = [];

function drawThreads(tiles, lines) {
  threadLines = lines;
  let svg = $("board").querySelector(".threads");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "threads");
    $("board").appendChild(svg);
  }
  const centre = (t) => [t.offsetLeft + t.offsetWidth / 2, t.offsetTop + t.offsetHeight / 2];
  const pin = (x, y) =>
    `<circle cx="${x}" cy="${y + 1.5}" r="5" fill="rgba(0,0,0,.45)"/>` +
    `<circle cx="${x}" cy="${y}" r="4.5" style="fill:var(--thread-pin,#6d120c)"/>` +
    `<circle cx="${x - 1.2}" cy="${y - 1.4}" r="1.6" fill="#d8857a"/>`;
  svg.innerHTML = lines
    .map((line) => {
      const [x1, y1] = centre(tiles[line[0]]);
      const [x2, y2] = centre(tiles[line[line.length - 1]]);
      const ends = `x1="${x1}" x2="${x2}" stroke-linecap="round"`;
      return (
        `<line ${ends} y1="${y1 + 2}" y2="${y2 + 2}" stroke="rgba(0,0,0,.4)" stroke-width="3.5"/>` +
        `<line ${ends} y1="${y1}" y2="${y2}" style="stroke:var(--thread,#a51f15)" stroke-width="2.6"/>` +
        pin(x1, y1) +
        pin(x2, y2)
      );
    })
    .join("");
}

function huntedCount() {
  const real = state.cells.filter((c) => !c.free).length;
  const done = state.cells.filter((c, i) => !c.free && state.marks[i]).length;
  return { real, done };
}

function updateMarks() {
  const tiles = boardTiles();
  const finished = boardLines(state.n).filter((line) => line.every((i) => state.marks[i]));
  const inLine = new Set(finished.flat());
  drawThreads(tiles, finished);
  tiles.forEach((tile, i) => {
    tile.setAttribute("aria-pressed", String(Boolean(state.marks[i])));
    tile.classList.toggle("inline", inLine.has(i));
  });

  const { real, done } = huntedCount();
  $("count").textContent = `${done} of ${real} hunted`;
  const bingos = $("bingos");
  if (real && done === real) bingos.textContent = "Blackout!";
  else bingos.textContent = finished.length === 1 ? "1 bingo" : `${finished.length} bingos`;
  bingos.classList.toggle("win", finished.length > 0);
}

// monster settings

const DEFAULTS = {};
for (const key in GAMES) DEFAULTS[key] = structuredClone(GAMES[key].monsters);

function validMonster(m) {
  return Array.isArray(m) && typeof m[0] === "string" && typeof m[1] === "string" && m[2] >= 1 && m[2] <= 5;
}

// saved settings can only change the ranks, threat and on/off state of the built-in monsters
function applyRoster(roster) {
  let applied = 0;
  for (const key in roster) {
    if (!GAMES[key] || !Array.isArray(roster[key])) continue;
    const saved = new Map(roster[key].filter(validMonster).map((m) => [m[0], m]));
    GAMES[key].monsters = DEFAULTS[key].map((original) => {
      const m = original.slice();
      const change = saved.get(m[0]);
      if (change) {
        m[1] = Object.keys(GAMES[key].ranks)
          .filter((r) => change[1].includes(r))
          .join("");
        m[2] = Math.round(change[2]);
        if (change[4]) {
          m[3] = m[3] || null;
          m[4] = 1;
        }
      }
      return m;
    });
    applied++;
  }
  return applied;
}

function saveRoster() {
  const changed = {};
  for (const key in GAMES) {
    if (JSON.stringify(GAMES[key].monsters) !== JSON.stringify(DEFAULTS[key]))
      changed[key] = GAMES[key].monsters;
  }
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(changed));
  } catch (e) {}
}

function loadRoster() {
  try {
    const roster = JSON.parse(localStorage.getItem(ROSTER_KEY));
    if (roster) applyRoster(roster);
  } catch (e) {}
}

function editorCounts() {
  const g = GAMES[edGame];
  const parts = Object.entries(g.ranks).map(([key, label]) => {
    return `${label} ${g.monsters.filter((m) => m[1].includes(key)).length}`;
  });
  const unranked = g.monsters.filter((m) => !m[1]).length;
  const disabled = g.monsters.filter((m) => m[4]).length;
  if (unranked) parts.push(`no rank ${unranked}`);
  if (disabled) parts.push(`disabled ${disabled}`);
  $("edCounts").textContent = `${g.monsters.length} monsters in this game: ${parts.join(", ")}.`;
}

function editorFilterOptions() {
  const g = GAMES[edGame];
  const options = [["", "All monsters"]];
  for (const [key, label] of Object.entries(g.ranks)) options.push([key, label + " Rank only"]);
  options.push(["-", "No rank set"], ["off", "Disabled only"]);
  for (const key in VARIANTS) {
    if (g.monsters.some((m) => m[3] === key)) options.push(["v:" + key, VARIANTS[key] + " only"]);
  }

  const select = $("edRank");
  const previous = select.value;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some(([value]) => value === previous) ? previous : "";
}

function matchesFilter(m, filter) {
  if (filter === "") return true;
  if (filter === "off") return Boolean(m[4]);
  if (filter === "-") return !m[1];
  if (filter.startsWith("v:")) return m[3] === filter.slice(2);
  return m[1].includes(filter);
}

function editorRow(m) {
  const g = GAMES[edGame];
  const row = document.createElement("div");
  row.className = "ed-row";

  const name = document.createElement("span");
  name.className = "nm";
  name.textContent = m[0];

  const chips = document.createElement("div");
  chips.className = "chips";
  for (const [key, label] of Object.entries(g.ranks)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(m[1].includes(key)));
    chip.addEventListener("click", () => {
      const on = !m[1].includes(key);
      m[1] = Object.keys(g.ranks)
        .filter((r) => (r === key ? on : m[1].includes(r)))
        .join("");
      chip.setAttribute("aria-pressed", String(on));
      saveRoster();
      editorCounts();
    });
    chips.appendChild(chip);
  }

  const threat = document.createElement("div");
  threat.className = "stars";
  threat.setAttribute("role", "group");
  threat.setAttribute("aria-label", "Threat");
  const paintThreat = () => [...threat.children].forEach((b, i) => b.classList.toggle("on", i < m[2]));
  for (let level = 1; level <= 5; level++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "★";
    b.setAttribute("aria-label", `Threat ${level} of 5`);
    b.addEventListener("click", () => {
      m[2] = level;
      paintThreat();
      saveRoster();
    });
    threat.appendChild(b);
  }
  paintThreat();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "toggle";
  toggle.setAttribute("aria-label", `Include ${m[0]} in boards`);
  const paintToggle = () => {
    const on = !m[4];
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = on ? "In pool" : "Disabled";
    row.classList.toggle("off", !on);
  };
  toggle.addEventListener("click", () => {
    if (m[4]) {
      m.length = m[3] ? 4 : 3;
    } else {
      m[3] = m[3] || null;
      m[4] = 1;
    }
    paintToggle();
    saveRoster();
    editorCounts();
  });
  paintToggle();

  row.append(name, chips, threat, toggle);
  return row;
}

function renderEditor() {
  editorFilterOptions();
  const search = $("edSearch").value.trim().toLowerCase();
  const filter = $("edRank").value;

  const head = document.createElement("div");
  head.className = "ed-head";
  head.innerHTML = "<span>Monster</span><span>Appears in</span><span>Threat</span><span>Use</span>";

  const rows = GAMES[edGame].monsters
    .filter((m) => m[0].toLowerCase().includes(search) && matchesFilter(m, filter))
    .map(editorRow);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "ed-empty";
    empty.textContent = "No monsters match.";
    rows.push(empty);
  }
  $("edList").replaceChildren(head, ...rows);
  editorCounts();
}

function disarmReset() {
  resetArmed = false;
  $("resetGame").textContent = "Reset this game";
}

// pages

function disarmReroll() {
  rerollArmed = false;
  $("navReroll").textContent = "New board";
}

function showView(name) {
  view = name;
  document.querySelector(".wrap").dataset.view = name;
  $("menu").hidden = name !== "menu";
  $("controls").hidden = name !== "wizard";
  $("editor").hidden = name !== "editor";
  document.querySelector(".stage").hidden = name !== "board";
  $("navSave").hidden = $("navReroll").hidden = $("clear").hidden = name !== "board";
  $("navMenu").hidden = name === "menu";
  disarmReroll();

  if (name === "menu") {
    const hasBoard = state.cells.length > 0;
    $("mContinue").hidden = !hasBoard;
    if (hasBoard) {
      const { real, done } = huntedCount();
      $("mContinueInfo").textContent = `${boardLabel()}, ${done} of ${real} hunted`;
    }
    setBackdrop(boardGame());
  } else if (name === "wizard") {
    $("seed").value = "";
    renderControls();
    setStep(1);
  } else if (name === "board") {
    setBackdrop(boardGame());
    updateMarks();
  } else if (name === "editor") {
    edGame = boardGame();
    $("edGame").value = edGame;
    setBackdrop(edGame);
    disarmReset();
    renderEditor();
  }
  window.scrollTo(0, 0);
}

// saving the board as a picture

const PNG_LOOK = {
  world: { bg: "#a8241d", frame: "#d7a23e", edge: "#5b120e", ink: "#fff4d6" },
  rise: { bg: "#8d8350", frame: "#b23324", edge: "#e0bb68", ink: "#ffffff" },
  gu: { bg: "#3f7397", frame: "#8a6034", edge: "#f3e6bd", ink: "#fff6dc" },
  frontier: { bg: "#b7a37a", frame: "#7a5636", edge: "#5a1210", ink: "#fff3c9" },
  wilds: { bg: "#5a3a26", frame: "#e39a35", edge: "#f8dc92", ink: "#2a1a08" },
};

const images = {};

function loadImage(src) {
  if (!images[src]) {
    images[src] = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  return images[src];
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const longer = line ? line + " " + word : word;
    if (line && ctx.measureText(longer).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  lines.push(line);
  return lines;
}

async function boardPNG() {
  const game = boardGame();
  const n = state.n;
  const look = PNG_LOOK[game];
  const flat = game === "wilds" || game === "frontier";
  const pixel = game === "gu" || game === "frontier";

  const W = 1400;
  const head = 150;
  const pad = 70;
  const gap = 22;
  const size = (W - pad * 2 - gap * (n - 1)) / n;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = head + W;
  const c = canvas.getContext("2d");

  const paperFile = game === "world" || game === "wilds" ? "img/tex-kraft.webp" : "img/tex-paper.webp";
  const [sheet, stamp, paper] = await Promise.all([
    loadImage(ICONS[game].sheet),
    loadImage("img/stamp-hunted.webp"),
    loadImage(paperFile),
  ]);
  await document.fonts.ready;

  const slipColour = getComputedStyle(document.documentElement).getPropertyValue("--slip").trim();
  const bodyFont = getComputedStyle(document.body).fontFamily;
  const headFont = getComputedStyle($("boardTitle")).fontFamily;

  c.fillStyle = look.frame;
  c.fillRect(0, 0, W, head + W);
  c.fillStyle = look.bg;
  c.fillRect(22, head, W - 44, W - 22);
  c.strokeStyle = look.edge;
  c.lineWidth = 5;
  c.strokeRect(36, head + 14, W - 72, W - 50);

  const { real, done } = huntedCount();
  c.fillStyle = look.ink;
  c.textBaseline = "middle";
  c.font = `600 54px ${headFont}`;
  c.fillText(boardLabel(), 44, 62, W - 88);
  c.font = `400 34px ${bodyFont}`;
  c.fillText(`${done} of ${real} hunted`, 44, 116);
  c.textAlign = "right";
  c.fillText("Code " + state.seed, W - 44, 116);

  state.cells.forEach((cell, i) => {
    const h = hash(state.seed + ":" + i);
    const x = pad + (i % n) * (size + gap);
    const y = head + pad - 10 + Math.floor(i / n) * (size + gap);
    const tilt = flat ? 0 : ((((h >> 3) % 7) - 3) * 0.22 * Math.PI) / 180;
    const marked = !cell.free && state.marks[i];
    const icon = !cell.free && iconFor(game, cell.name);

    c.save();
    c.translate(x + size / 2, y + size * 0.07);
    c.rotate(tilt);
    c.translate(-size / 2, -size * 0.07);

    c.shadowColor = "rgba(0,0,0,.45)";
    c.shadowBlur = 14;
    c.shadowOffsetY = 6;
    c.fillStyle = cell.free ? "#cdbb8f" : slipColour;
    c.fillRect(0, 0, size, size);
    c.shadowColor = "transparent";

    if (paper) {
      c.save();
      c.beginPath();
      c.rect(0, 0, size, size);
      c.clip();
      c.globalCompositeOperation = "multiply";
      c.drawImage(paper, (h >> 5) % 200, (h >> 11) % 200, 300, 300, 0, 0, size, size);
      c.restore();
    }

    c.textAlign = "center";
    if (cell.free) {
      c.fillStyle = "#3a2a18";
      c.font = `italic 500 ${size * 0.2}px ${headFont}`;
      c.fillText("Free", size / 2, size / 2);
    } else if (icon && sheet) {
      const frame = sheet.width / icon.cols;
      const d = size * 0.78;
      c.save();
      c.imageSmoothingEnabled = !pixel;
      if (marked) c.filter = "grayscale(1) opacity(.5)";
      c.drawImage(
        sheet,
        (icon.i % icon.cols) * frame,
        Math.floor(icon.i / icon.cols) * frame,
        frame,
        frame,
        (size - d) / 2,
        size * 0.16,
        d,
        d,
      );
      c.restore();
      if (isHyper(cell.name)) {
        c.font = `700 ${size * 0.2}px ${headFont}`;
        c.lineWidth = size * 0.035;
        c.strokeStyle = "#2b1a06";
        c.fillStyle = "#f7cf2b";
        c.textAlign = "left";
        c.strokeText("H", size * 0.78, size * 0.24);
        c.fillText("H", size * 0.78, size * 0.24);
        c.textAlign = "center";
      }
    }

    const named = (NAMED_ICONS[game] || []).includes(cell.name);
    if (!cell.free && (!icon || named)) {
      const fontSize = size * (icon ? 0.095 : 0.13);
      const middle = icon ? size * 0.9 : size / 2;
      c.fillStyle = marked ? "rgba(40,28,16,.5)" : "#2a1d10";
      c.font = `700 ${fontSize}px ${bodyFont}`;
      const lines = wrapText(c, cell.name, size * 0.86);
      lines.forEach((line, k) => {
        const offset = (k - (lines.length - 1) / 2) * fontSize * 1.15;
        c.fillText(line, size / 2, middle + offset, size * 0.9);
      });
    }

    if (cell.star) {
      c.save();
      c.translate(size * 0.05, size * 0.075);
      if (pixel) {
        c.font = `700 ${size * 0.062}px "Pixelify Sans", monospace`;
      } else if (game === "rise") {
        c.rotate((-7 * Math.PI) / 180);
        c.font = `400 ${size * 0.1}px "Nanum Brush Script", cursive`;
      } else {
        c.rotate((-7 * Math.PI) / 180);
        c.font = `400 ${size * 0.08}px "Caveat Brush", cursive`;
      }
      c.fillStyle = starInk(game, cell.name) || (game === "rise" ? "#2b2622" : "#4a2c14");
      if (marked) c.globalAlpha = 0.45;
      c.textAlign = "left";
      c.fillText(cell.star, 0, 0);
      c.restore();
    }

    if (marked && stamp) {
      const w = size * 0.98;
      const stampHeight = (w * stamp.height) / stamp.width;
      c.save();
      c.translate(size / 2, size / 2);
      c.rotate(((4 - ((h >> 7) % 9)) * Math.PI) / 180);
      c.globalCompositeOperation = "multiply";
      c.drawImage(stamp, -w / 2, -stampHeight / 2, w, stampHeight);
      c.restore();
    }

    if (!flat) {
      const r = size * 0.05;
      const px = size / 2;
      const py = size * 0.085;
      const steel = c.createLinearGradient(px - r, py - r, px + r, py + r);
      steel.addColorStop(0, "#f6f8fa");
      steel.addColorStop(0.5, "#c9ced3");
      steel.addColorStop(1, "#9aa1a8");
      c.shadowColor = "rgba(0,0,0,.5)";
      c.shadowBlur = 5;
      c.shadowOffsetX = 2;
      c.shadowOffsetY = 3;
      c.fillStyle = steel;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
      c.shadowColor = "transparent";
      c.lineWidth = 2;
      c.strokeStyle = "#5a6269";
      c.stroke();
    }
    c.restore();
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function savePNG() {
  const button = $("navSave");
  button.textContent = "Making picture";
  button.disabled = true;
  try {
    const url = URL.createObjectURL(await boardPNG());
    const link = document.createElement("a");
    link.href = url;
    link.download = `monster-hunter-bingo-${state.seed}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    $("pngView").hidden = false;
  }
  button.textContent = "Save board PNG";
  button.disabled = false;
}

// events

for (const [key, g] of Object.entries(GAMES)) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "gamecard";
  card.dataset.game = key;
  card.style.backgroundImage = `url("img/bg-${key}.webp")`;
  const label = document.createElement("span");
  label.textContent = g.label;
  card.appendChild(label);
  card.addEventListener("click", () => {
    state.game = key;
    renderControls();
    setStep(2);
  });
  $("games").appendChild(card);

  $("edGame").appendChild(new Option(g.label, key));
}

$("mContinue").addEventListener("click", () => showView("board"));
$("mNew").addEventListener("click", () => showView("wizard"));
$("mSettings").addEventListener("click", () => showView("editor"));
$("navMenu").addEventListener("click", () => showView("menu"));
$("navSave").addEventListener("click", savePNG);
$("pngClose").addEventListener("click", () => ($("pngView").hidden = true));

$("wBack").addEventListener("click", () => (wizStep === 1 ? showView("menu") : setStep(wizStep - 1)));
$("wNext").addEventListener("click", () => setStep(wizStep + 1));
$("exp").addEventListener("change", (e) => {
  state.noExp[state.game] = !e.target.checked;
  renderControls();
});
$("free").addEventListener("change", (e) => (state.free = e.target.checked));
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  if (wizStep < 3) return setStep(wizStep + 1);
  const typed = $("seed").value.trim().toUpperCase();
  showView("board");
  generate(typed || newSeed());
});

$("navReroll").addEventListener("click", () => {
  const { done } = huntedCount();
  if (done && !rerollArmed) {
    rerollArmed = true;
    $("navReroll").textContent = "Click again to replace";
    return;
  }
  disarmReroll();
  generate(newSeed());
});
$("clear").addEventListener("click", () => {
  state.marks = state.cells.map((c) => Boolean(c.free));
  save();
  updateMarks();
});
$("boardCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.seed);
    $("boardCode").textContent = "Copied";
    setTimeout(() => ($("boardCode").textContent = "Code " + state.seed), 1200);
  } catch (e) {}
});

$("edGame").addEventListener("change", (e) => {
  edGame = e.target.value;
  setBackdrop(edGame);
  $("edSearch").value = "";
  disarmReset();
  renderEditor();
});
$("edSearch").addEventListener("input", renderEditor);
$("edRank").addEventListener("change", renderEditor);
$("resetGame").addEventListener("click", () => {
  if (!resetArmed) {
    resetArmed = true;
    $("resetGame").textContent = "Click again to reset";
    return;
  }
  GAMES[edGame].monsters = structuredClone(DEFAULTS[edGame]);
  saveRoster();
  disarmReset();
  renderEditor();
});
$("ioCopy").addEventListener("click", async () => {
  const all = {};
  for (const key in GAMES) all[key] = GAMES[key].monsters;
  const text = JSON.stringify(all);
  $("ioBox").value = text;
  try {
    await navigator.clipboard.writeText(text);
    $("ioMsg").textContent = "Copied.";
  } catch (e) {
    $("ioBox").select();
    $("ioMsg").textContent = "Select the text in the box and copy it.";
  }
});
$("ioApply").addEventListener("click", () => {
  let applied = 0;
  try {
    applied = applyRoster(JSON.parse($("ioBox").value));
  } catch (e) {}
  if (!applied) {
    $("ioMsg").textContent = "That text isn't a settings copy. Paste exactly what Copy my settings gave you.";
    return;
  }
  saveRoster();
  renderEditor();
  $("ioMsg").textContent = `Applied settings for ${applied} game${applied > 1 ? "s" : ""}.`;
});

new ResizeObserver(() => {
  const tiles = boardTiles();
  if (tiles.length) {
    drawThreads(
      tiles,
      threadLines.filter((line) => line.every((i) => tiles[i])),
    );
  }
}).observe($("board"));

loadRoster();
load();
renderControls();
if (state.cells.length) renderBoard();
showView("menu");
