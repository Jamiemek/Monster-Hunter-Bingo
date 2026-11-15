const $ = (id) => document.getElementById(id);

const STATE_KEY = "mh-bingo-v1";
const ROSTER_KEY = "mh-bingo-roster-v1";

let state = {
  game: "world",
  rank: "H",
  diff: "normal",
  size: 5,
  free: true,
  weapons: false,
  varPct: {},
  noExp: {},
  seed: "",
  n: 5,
  cells: [],
  marks: [],
  raceName: "",
  raceSetup: {
    names: ["", ""],
    room: { address: "", slot: "Bingo", password: "" },
    games: ["world"],
    rank: 1,
    diff: "normal",
    length: 5,
    split: false,
    special: 0,
    weapons: false,
    ownWeapons: false,
  },
  race: null,
};

let view = "menu";
let wizStep = 1;
let rerollArmed = false;
let resetArmed = false;
let edGame = "world";

// a race is kept per tab, so two tabs in one browser can be different people
function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, race: null }));
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state.race));
  } catch (e) {}
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (saved && GAMES[saved.game] && Array.isArray(saved.cells)) Object.assign(state, saved);
    state.raceSetup = { names: ["", ""], room: { address: "", slot: "", password: "" }, ...state.raceSetup };
    state.raceSetup.room.slot ||= "Bingo";
    state.race = JSON.parse(sessionStorage.getItem(STATE_KEY));
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

function weightCurve(diff) {
  const weights = DIFFS[diff].w;
  return (difficulty) => {
    const x = Math.max(0, Math.min(1, difficulty)) * 4;
    const i = Math.floor(x);
    return weights[i] + (weights[Math.min(4, i + 1)] - weights[i]) * (x - i);
  };
}

function pickRow(rows, weightAt, rand) {
  const rowWeights = rows.map((row) => weightAt(row[2]));
  let roll = rand() * rowWeights.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < rows.length - 1 && (roll -= rowWeights[i]) > 0) i++;
  return rows[i];
}

function weaponsFor(game) {
  const missing = MISSING_WEAPONS[game] || [];
  return WEAPONS.filter((w) => !missing.includes(w)).concat(EXTRA_WEAPONS[game] || []);
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
  const settings = [seed, state.game, state.rank, state.diff, n, state.free, percents];
  if (state.weapons) settings.push("weapons");
  const rand = rng(hash(settings.join("|")));

  const weights = DIFFS[state.diff].w;
  const weightAt = weightCurve(state.diff);
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
    const star = rows.length ? pickRow(rows, weightAt, rand)[1] : "";
    return { name: m[0], star };
  });
  if (state.weapons) {
    const weapons = weaponsFor(state.game);
    for (const cell of cells) cell.weapon = weapons[Math.floor(rand() * weapons.length)];
  }
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
  $("weapons").checked = state.weapons;
  $("pool").textContent = poolText();
}

const STEP_TITLES = ["Choose a game", "Rank and monsters", "Difficulty and board"];

function setStep(n) {
  wizStep = n;
  for (const el of document.querySelectorAll("#controls .step")) el.hidden = Number(el.dataset.step) !== n;
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

function setSprite(el, icon) {
  const col = icon.i % icon.cols;
  const row = Math.floor(icon.i / icon.cols);
  el.style.backgroundImage = `url("${icon.sheet}")`;
  el.style.backgroundSize = `${icon.cols * 100}% ${icon.rows * 100}%`;
  el.style.backgroundPosition = `${(col / (icon.cols - 1)) * 100}% ${(row / (icon.rows - 1)) * 100}%`;
}

function weaponBadge(weapon) {
  const badge = document.createElement("span");
  badge.className = "weapon";
  badge.title = weapon;
  const i = WEAPONS.indexOf(weapon);
  if (i < 0) {
    badge.classList.add("text");
    badge.textContent = weapon;
  } else {
    badge.style.setProperty("--at", `${(i % 5) * 25}% ${Math.floor(i / 5) * 50}%`);
  }
  return badge;
}

function renderTile(cell, key, game) {
  const h = hash(key);
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile p" + (h % 3);
  tile.title = cell.star ? `${cell.name}, ${cell.star}` : cell.name;
  tile.style.setProperty("--tilt", (((h >> 3) % 7) - 3) * 0.22 + "deg");
  tile.style.setProperty("--rot", -(5 + ((h >> 7) % 9)) + "deg");
  tile.style.setProperty("--bx", ((h >> 5) % 300) + "px");
  tile.style.setProperty("--by", ((h >> 11) % 300) + "px");

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
    setSprite(img, icon);
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

  if (cell.weapon) {
    tile.appendChild(weaponBadge(cell.weapon));
    tile.title += ", " + cell.weapon;
  }
  return tile;
}

function renderBoard() {
  const board = $("board");
  const tiles = state.cells.map((cell, i) => {
    const tile = renderTile(cell, state.seed + ":" + i, boardGame());
    if (!cell.free) {
      tile.addEventListener("click", () => {
        state.marks[i] = !state.marks[i];
        save();
        updateMarks();
      });
    }
    return tile;
  });
  board.style.setProperty("--n", state.n);
  board.replaceChildren(...tiles);
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

// races

const RACE_RANKS = ["Low", "High", "Master / G", "Zenith"];
const RACE_LENGTHS = [3, 5, 7, 10];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RACE_FLOWS = { join: ["role", "join"], host: ["role", "who", "rules", "live"] };
const RACE_TITLES = {
  role: "Hosting or joining?",
  join: "Join a race",
  who: "Players and games",
  rules: "Race rules",
  live: "Live room",
};

let raceFlow = "host";
let raceStep = "role";

// a race code is four characters of settings followed by a five character seed
function encodeRace(setup) {
  const games = Object.keys(GAMES);
  let bits = 0;
  const put = (value, width) => (bits = bits * 2 ** width + value);
  put(
    games.reduce((mask, key, i) => mask + (setup.games.includes(key) ? 2 ** i : 0), 0),
    5,
  );
  put(setup.rank, 2);
  put(Object.keys(DIFFS).indexOf(setup.diff), 2);
  put(RACE_LENGTHS.indexOf(setup.length), 2);
  put(setup.special / 5, 4);
  put(setup.weapons ? 1 : 0, 1);
  put(setup.split ? 1 : 0, 1);
  put(setup.weapons && setup.ownWeapons ? 1 : 0, 1);
  put(0, 2);

  let code = "";
  for (let i = 3; i >= 0; i--) code += CODE_CHARS[Math.floor(bits / 32 ** i) % 32];
  return code + "-" + newSeed().slice(0, 5);
}

// a trailing -1 or -2 says which list the player gets
function decodeRace(text) {
  let code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let side = null;
  if (code.length === 10 && "12".includes(code[9])) {
    side = Number(code[9]) - 1;
    code = code.slice(0, 9);
  }
  if (code.length !== 9 || [...code].some((ch) => !CODE_CHARS.includes(ch))) return null;

  let bits = 0;
  for (const ch of code.slice(0, 4)) bits = bits * 32 + CODE_CHARS.indexOf(ch);
  const take = (width) => {
    const value = bits % 2 ** width;
    bits = Math.floor(bits / 2 ** width);
    return value;
  };
  take(2);
  const ownWeapons = take(1) === 1;
  const split = take(1) === 1;
  const weapons = take(1) === 1;
  const special = take(4) * 5;
  const length = RACE_LENGTHS[take(2)];
  const diff = Object.keys(DIFFS)[take(2)];
  const rank = take(2);
  const mask = take(5);
  const games = Object.keys(GAMES).filter((key, i) => Math.floor(mask / 2 ** i) % 2);
  if (!games.length || special > 50) return null;

  code = code.slice(0, 4) + "-" + code.slice(4);
  return { code, side, games, rank, diff, length, split, special, weapons, ownWeapons };
}

function raceRank(game, level) {
  const keys = Object.keys(GAMES[game].ranks);
  return keys[Math.min(level, keys.length - 1)];
}

function raceCandidates(race, rand) {
  const weightAt = weightCurve(race.diff);
  const found = [];
  for (const game of race.games) {
    const g = GAMES[game];
    const rank = raceRank(game, race.rank);
    const ranks = (g.pools && g.pools[rank]) || rank;
    for (const m of g.monsters) {
      if (m[4] || ![...ranks].some((r) => m[1].includes(r))) continue;
      const rows = starRows(game, m, ranks);
      const row = rows.length ? pickRow(rows, weightAt, rand) : null;
      const difficulty = row ? row[2] : (m[2] - 1) / 4;
      found.push({
        game,
        name: m[0],
        star: row ? row[1] : "",
        special: Boolean(m[3]),
        difficulty,
        score: Math.pow(rand(), 1 / weightAt(difficulty)),
      });
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

// with two lists, each step pairs monsters of similar difficulty
function buildRace(race) {
  const rand = rng(hash("race|" + race.code));
  const candidates = raceCandidates(race, rand);
  const lists = race.split ? 2 : 1;
  const normal = candidates.filter((c) => !c.special);
  const special = candidates.filter((c) => c.special);

  let length = race.length;
  while (length > 0 && normal.length + special.length < length * lists) length--;
  const wanted = race.special ? Math.max(1, Math.round((length * race.special) / 100)) * lists : 0;
  const specials = special.slice(0, Math.min(wanted, special.length));
  const chosen = specials.concat(normal.slice(0, length * lists - specials.length));
  chosen.push(...special.slice(specials.length, specials.length + length * lists - chosen.length));
  chosen.sort((a, b) => a.difficulty - b.difficulty);

  const sides = race.split || race.ownWeapons ? 2 : 1;
  const steps = [];
  for (let i = 0; i < length; i++) {
    const picked = chosen.slice(i * lists, (i + 1) * lists);
    if (lists === 2 && rand() < 0.5) picked.reverse();
    const rolls = [rand()];
    rolls.push(race.ownWeapons ? rand() : rolls[0]);
    const step = [];
    for (let side = 0; side < sides; side++) {
      const { game, name, star } = picked[Math.min(side, lists - 1)];
      const weapons = weaponsFor(game);
      const weapon = race.weapons ? weapons[Math.floor(rolls[side] * weapons.length)] : undefined;
      step.push({ game, name, star, weapon });
    }
    steps.push(step);
  }
  for (let i = steps.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [steps[i], steps[j]] = [steps[j], steps[i]];
  }

  return Array.from({ length: sides }, (_, side) => steps.map((step) => step[side]));
}

function startRace(settings, mode, sides, names, room) {
  const lists = buildRace(settings);
  state.race = {
    ...settings,
    mode,
    names,
    room,
    side: sides[0],
    lists: sides.map((side) => lists[Math.min(side, lists.length - 1)]),
    sides: sides.map(() => ({ pos: 0, splits: [], finishedAt: 0 })),
    startedAt: 0,
  };
  save();
  openLink();
  renderRace();
}

function hostRace() {
  const setup = state.raceSetup;
  const names = [setup.names[0] || "Player 1", setup.names[1] || "Player 2"];
  const room = setup.room.address && setup.room.slot ? { ...setup.room } : null;
  startRace(decodeRace(encodeRace(setup)), "ref", [0, 1], names, room);
}

// an invite is a race code, optionally followed by @address/slot/password
function joinRace() {
  const [code, where] = $("raceCode").value.trim().split("@");
  const settings = decodeRace(code);
  if (!settings) {
    $("raceError").textContent = "That isn't a race code. It looks like ABCD-EFGHJ.";
    return;
  }
  let room = null;
  if (where) {
    const [address, slot, password = ""] = where.split("/").map(decodeURIComponent);
    if (address && slot) room = { address, slot, password };
  }
  $("raceCode").value = "";
  const side = settings.side === null ? 1 : settings.side;
  startRace(settings, "join", [side], [state.raceName || "Hunter"], room);
}

function inviteText(race, side) {
  let text = `${race.code}-${side + 1}`;
  if (race.room) {
    const { address, slot, password } = race.room;
    text += "@" + [address, encodeURIComponent(slot), encodeURIComponent(password)].filter(Boolean).join("/");
  }
  return text;
}

function inviteLink(race, side) {
  return location.origin + location.pathname + "#join=" + encodeURIComponent(inviteText(race, side));
}

function inviteMessage(race, side) {
  return [
    `${race.names[side]}, you're in a Monster Hunter Bingo race.`,
    `1. Open this link: ${inviteLink(race, side)}`,
    "2. Press Join race.",
    "3. Wait for me to start the clock. Your monsters appear on that page one at a time.",
    `If the link doesn't fill in the invite, paste this instead: ${inviteText(race, side)}`,
  ].join("\n");
}

// live link: the commentator keeps the race in an Archipelago room's data storage and players watch it

let link = null;

function raceNow() {
  return Date.now() + (link ? link.offset : 0);
}

function closeLink() {
  if (link) {
    clearTimeout(link.retry);
    link.socket.onclose = null;
    link.socket.close();
  }
  link = null;
}

function setLinkStatus(text) {
  link.status = text;
  if (view === "race") renderRace();
}

function openLink() {
  closeLink();
  const race = state.race;
  if (!race || !race.room) return;

  const key = "mhbingo:" + race.code;
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  const socket = new WebSocket(scheme + race.room.address);
  const send = (...packets) => socket.send(JSON.stringify(packets));
  link = {
    socket,
    key,
    send,
    status: "Connecting to the room",
    offset: 0,
    live: false,
    seen: [false, false],
  };

  socket.onmessage = (event) => {
    for (const packet of JSON.parse(event.data)) {
      if (packet.cmd === "RoomInfo") {
        link.offset = Math.round(packet.time * 1000 - Date.now());
        send({
          cmd: "Connect",
          game: "",
          name: race.room.slot,
          password: race.room.password,
          uuid: "mhbingo-" + race.code,
          version: packet.version,
          items_handling: 0,
          tags: ["TextOnly"],
          slot_data: false,
        });
      } else if (packet.cmd === "Connected") {
        link.live = true;
        const seen = [key + ":joined1", key + ":joined2"];
        if (race.mode === "ref") {
          pushRace();
          send({ cmd: "Get", keys: seen }, { cmd: "SetNotify", keys: seen });
        } else {
          const operations = [{ operation: "replace", value: Date.now() }];
          send({ cmd: "Set", key: seen[race.side], default: 0, want_reply: false, operations });
          send({ cmd: "Get", keys: [key] }, { cmd: "SetNotify", keys: [key] });
        }
        setLinkStatus("Connected to the room");
      } else if (packet.cmd === "ConnectionRefused") {
        setLinkStatus("The room refused the connection. Check the player name and password.");
      } else if (packet.cmd === "Retrieved") {
        for (const [name, value] of Object.entries(packet.keys)) roomValue(name, value);
      } else if (packet.cmd === "SetReply") {
        roomValue(packet.key, packet.value);
      }
    }
  };
  socket.onclose = () => {
    link.live = false;
    link.retry = setTimeout(openLink, 5000);
    setLinkStatus("Can't reach the room. Trying again every few seconds.");
  };
}

function roomValue(name, value) {
  if (name === link.key) return followRace(value);
  const joined = name.match(/:joined([12])$/);
  if (joined && value) {
    link.seen[joined[1] - 1] = true;
    if (view === "race") renderRace();
  }
}

function pushRace() {
  const race = state.race;
  if (!link || !link.live || race.mode !== "ref") return;
  const { code, names, lists, startedAt, sides } = race;
  const value = { code, names, lists, startedAt, sides };
  link.send({
    cmd: "Set",
    key: link.key,
    default: null,
    want_reply: false,
    operations: [{ operation: "replace", value }],
  });
}

function followRace(value) {
  const race = state.race;
  if (!race || race.mode !== "join" || !value || value.code !== race.code) return;
  const other = value.sides.length - 1 - race.side;
  race.startedAt = value.startedAt;
  race.names = [value.names[race.side]];
  race.lists = [value.lists[race.side]];
  race.sides = [value.sides[race.side]];
  race.rival = { name: value.names[other], ...value.sides[other] };
  save();
  if (view === "race") renderRace();
}

function saveRace() {
  save();
  pushRace();
  renderRace();
}

function raceSummary(race) {
  const games = race.games.map((key) => GAMES[key].label).join(" + ");
  const ranks = [...new Set(race.games.map((key) => GAMES[key].ranks[raceRank(key, race.rank)]))];
  const parts = [
    `${race.lists[0].length} monsters`,
    games,
    `${ranks.join(" / ")} Rank`,
    DIFFS[race.diff].label,
    race.split ? "different lists" : "same list",
  ];
  if (race.special) parts.push(`${race.special}% special monsters`);
  if (race.weapons) parts.push(race.ownWeapons ? "a different random weapon each" : "random weapons");
  return parts.join(", ") + ".";
}

function clock(ms) {
  const total = Math.floor(ms / 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
}

function renderRaceLobby() {
  const setup = state.raceSetup;
  const flow = RACE_FLOWS[raceFlow];
  const update = (change) => {
    Object.assign(setup, change);
    renderRaceLobby();
  };

  for (const el of document.querySelectorAll("#raceLobby .step")) el.hidden = el.dataset.rstep !== raceStep;
  $("raceStepNo").textContent =
    raceStep === "role" ? "Step 1" : `Step ${flow.indexOf(raceStep) + 1} of ${flow.length}`;
  $("raceTitle").textContent = RACE_TITLES[raceStep];
  $("raceNext").hidden = raceStep === "role";
  $("raceNext").textContent = { join: "Join race", live: "Create race" }[raceStep] || "Next";

  $("joinName").value = state.raceName;
  $("refName1").value = setup.names[0];
  $("refName2").value = setup.names[1];
  $("roomAddress").value = setup.room.address;
  $("roomSlot").value = setup.room.slot;
  $("roomPassword").value = setup.room.password;

  const games = $("rGames");
  games.replaceChildren();
  for (const [key, g] of Object.entries(GAMES)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = g.label;
    b.setAttribute("aria-pressed", String(setup.games.includes(key)));
    b.addEventListener("click", () => {
      const picked = Object.keys(GAMES).filter((k) => (k === key) !== setup.games.includes(k));
      if (picked.length) update({ games: picked });
    });
    games.appendChild(b);
  }

  const levels = Math.max(...setup.games.map((key) => Object.keys(GAMES[key].ranks).length));
  if (setup.rank >= levels) setup.rank = levels - 1;
  segmented(
    "rRank",
    RACE_RANKS.slice(0, levels).map((label, i) => [i, label]),
    setup.rank,
    (rank) => update({ rank }),
  );
  segmented(
    "rDiff",
    Object.entries(DIFFS).map(([key, d]) => [key, d.label]),
    setup.diff,
    (diff) => update({ diff }),
  );
  segmented(
    "rLength",
    RACE_LENGTHS.map((n) => [n, String(n)]),
    setup.length,
    (length) => update({ length }),
  );
  segmented(
    "rSplit",
    [
      [false, "Same list"],
      [true, "Different lists"],
    ],
    setup.split,
    (split) => update({ split }),
  );
  $("rSpecial").value = setup.special;
  $("rSpecialOut").textContent = setup.special ? `${setup.special}% of the race` : "None";
  $("rWeapons").checked = setup.weapons;
  $("rOwnField").hidden = !setup.weapons;
  segmented(
    "rOwn",
    [
      [false, "Same weapons"],
      [true, "Different weapons"],
    ],
    Boolean(setup.ownWeapons),
    (ownWeapons) => update({ ownWeapons }),
  );
}

function raceStepTo(step) {
  raceStep = step;
  $("raceError").textContent = "";
  renderRaceLobby();
}

function copyButton(className, label, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = label), 1200);
    } catch (e) {}
  });
  return button;
}

function inviteRow(race, side) {
  const row = document.createElement("div");
  row.className = "coderow";
  const who = document.createElement("span");
  who.textContent = race.names[side];
  if (link && link.seen[side]) who.textContent += " has joined";
  const invite = inviteText(race, side);
  row.append(
    who,
    copyButton("racecode", invite, invite),
    copyButton("btn", "Copy message to send", inviteMessage(race, side)),
  );
  return row;
}

function renderRaceReady(race) {
  setBackdrop(race.lists[0].length ? race.lists[0][0].game : race.games[0]);
  $("raceSummary").textContent = raceSummary(race);

  const waiting = race.mode === "join" && race.room;
  let steps = ["Press Start race at the same moment as your opponent."];
  if (race.mode === "ref") {
    steps = [
      "Send each player their message. It has a link that fills in their invite.",
      race.room ? "Wait until both players show as joined." : "Check both players have the race open.",
      "Press Start race when both players begin hunting.",
      "Press Hunted under a player each time they finish a monster.",
    ];
  } else if (waiting) {
    steps = [
      "Keep this page open.",
      "The race begins when the commentator starts the clock.",
      "Your monsters appear here one at a time as the commentator confirms each hunt.",
    ];
  }
  const rows = race.mode === "ref" ? race.names.map((name, i) => inviteRow(race, i)) : [];
  $("raceCodes").replaceChildren(...rows);
  $("raceReadySteps").replaceChildren(
    ...steps.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
  $("raceStart").hidden = Boolean(waiting);
}

function rivalMarker(race) {
  const { name, pos } = race.rival;
  const marker = document.createElement("div");
  const label = document.createElement("span");
  label.textContent = name;
  const pips = document.createElement("span");
  pips.className = "pips";
  race.lists[0].forEach((cell, i) => {
    const pip = document.createElement("i");
    if (i < pos) pip.className = "on";
    pips.appendChild(pip);
  });
  marker.append(label, pips);
  return marker;
}

function targetCard(cell, race) {
  const card = document.createElement("div");
  card.className = "target";

  const portrait = document.createElement("div");
  portrait.className = "portrait";
  const icon = iconFor(cell.game, cell.name);
  if (icon) {
    const img = document.createElement("span");
    img.className = "icon";
    if (cell.game === "gu" || cell.game === "frontier") img.classList.add("px");
    setSprite(img, icon);
    portrait.appendChild(img);
  } else {
    portrait.textContent = "?";
  }

  const info = document.createElement("div");
  info.className = "info";
  const line = (className, text) => {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    info.appendChild(p);
    return p;
  };
  if (cell.star) line("tstar", cell.star).style.color = starInk(cell.game, cell.name);
  line("tname", cell.name);
  if (race.games.length > 1) line("tgame", GAMES[cell.game].label);
  if (cell.weapon) {
    const weapon = line("tweapon", cell.weapon);
    weapon.prepend(weaponBadge(cell.weapon));
  }

  card.append(portrait, info);
  return card;
}

function renderRaceStrip(list, pos) {
  const strip = document.createElement("div");
  strip.className = "racestrip";
  list.forEach((cell, i) => {
    const slot = document.createElement("span");
    slot.className = "slot";
    if (i < pos) {
      slot.classList.add("done");
      slot.title = cell.name;
      const icon = iconFor(cell.game, cell.name);
      if (icon) setSprite(slot, icon);
    } else {
      slot.textContent = i === pos ? i + 1 : "?";
      if (i === pos) slot.classList.add("now");
    }
    strip.appendChild(slot);
  });
  return strip;
}

function splitTimes(race, i) {
  const { splits } = race.sides[i];
  return race.lists[i].map((cell, k) => {
    return `${cell.name}, ${clock(splits[k] - (k ? splits[k - 1] : race.startedAt))}`;
  });
}

const ICON_TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
const ICON_UNDO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 13a6.8 6.8 0 1 0 2-5.2L4 11M4 5v6h6"/></svg>';

function sideButtons(race, i) {
  const side = race.sides[i];
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "btn";
  undo.textContent = "Undo";
  undo.disabled = side.pos === 0;
  undo.addEventListener("click", () => {
    side.pos--;
    side.splits.length = side.pos;
    side.finishedAt = 0;
    saveRace();
  });
  const hunted = document.createElement("button");
  hunted.type = "button";
  hunted.className = "btn primary";
  hunted.textContent = "Hunted";
  hunted.hidden = Boolean(side.finishedAt);
  hunted.addEventListener("click", () => {
    if (side.finishedAt) return;
    side.splits[side.pos] = raceNow();
    side.pos++;
    if (side.pos === race.lists[i].length) side.finishedAt = raceNow();
    saveRace();
  });
  return [undo, hunted];
}

function isWinner(race, i) {
  const first = Math.min(...race.sides.map((side) => side.finishedAt || Infinity));
  return race.sides.length > 1 && race.sides[i].finishedAt === first;
}

// the commentator's strip under each stream: the current monster and progress
function renderBanner(race, i) {
  const side = race.sides[i];
  const list = race.lists[i];
  const banner = document.createElement("div");
  banner.className = "banner";

  const now = document.createElement("div");
  now.className = "current";
  if (side.finishedAt) {
    now.textContent = "Finished in " + clock(side.finishedAt - race.startedAt);
    if (isWinner(race, i)) {
      banner.classList.add("winner");
      now.textContent += ", winner";
    }
  } else {
    const cell = list[side.pos];
    const name = document.createElement("span");
    name.className = "tname";
    name.textContent = [cell.star, cell.name].filter(Boolean).join(" ");
    now.appendChild(name);
  }

  banner.append(now, renderRaceStrip(list, side.pos));
  return banner;
}

function renderSide(race, i) {
  if (race.mode === "ref") return renderBanner(race, i);

  const side = race.sides[i];
  const list = race.lists[i];
  const el = document.createElement("div");
  el.className = "side";

  const head = document.createElement("div");
  head.className = "sidehead";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = race.names[i];
  const count = document.createElement("span");
  count.textContent = side.finishedAt ? "Finished" : `Monster ${side.pos + 1} of ${list.length}`;
  head.append(who, count);
  el.append(head, renderRaceStrip(list, side.pos));

  if (side.finishedAt) {
    const time = document.createElement("p");
    time.className = "finish";
    time.textContent = clock(side.finishedAt - race.startedAt);
    const splits = document.createElement("ol");
    splits.className = "splits";
    for (const text of splitTimes(race, i)) {
      const li = document.createElement("li");
      li.textContent = text;
      splits.appendChild(li);
    }
    el.append(time, splits);
  } else {
    el.appendChild(targetCard(list[side.pos], race));
  }

  if (race.mode === "join" && race.room) return el;

  const bar = document.createElement("div");
  bar.className = "wizbar";
  const [undo, hunted] = sideButtons(race, i);
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  bar.append(undo, spacer, hunted);
  el.appendChild(bar);
  return el;
}

function streamUrl(text) {
  const youtube = text.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}?autoplay=1&mute=1`;
  const twitch = text.trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv\/)?(\w{3,25})\/?$/);
  if (twitch) return `https://player.twitch.tv/?channel=${twitch[1]}&parent=${location.hostname}&muted=true`;
  return "";
}

function streamSlot(race, i) {
  const slot = document.createElement("div");
  slot.className = "streamslot";

  const head = document.createElement("div");
  head.className = "streamhead";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = race.names[i];
  const change = document.createElement("button");
  change.type = "button";
  change.className = "btn";
  change.textContent = "Change stream";

  const [undo, hunted] = sideButtons(race, i);
  undo.className = "iconbtn";
  undo.innerHTML = ICON_UNDO;
  undo.title = `${race.names[i]}: undo the last hunt`;
  hunted.className = "iconbtn tick";
  hunted.innerHTML = ICON_TICK;
  hunted.title = `${race.names[i]}: monster hunted`;
  for (const button of [undo, hunted]) button.setAttribute("aria-label", button.title);
  const weapon = document.createElement("span");
  weapon.className = "tweapon";
  const target = document.createElement("span");
  target.className = "icon";
  streamButtons[i] = { undo, hunted, weapon, target };
  head.append(who, weapon, target, change);

  const screen = document.createElement("div");
  screen.className = "stream";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Twitch channel or YouTube link";
  const note = document.createElement("p");

  const show = () => {
    const url = streamUrl(race.streams[i]);
    change.hidden = !url;
    if (!url) {
      note.textContent = race.streams[i] ? "That doesn't look like a Twitch channel or YouTube link." : "";
      screen.replaceChildren(input, note);
      return;
    }
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.allow = "autoplay; fullscreen";
    frame.title = `${race.names[i]}'s stream`;
    screen.replaceChildren(frame);
  };
  input.addEventListener("change", () => {
    race.streams[i] = input.value.trim();
    save();
    show();
  });
  change.addEventListener("click", () => {
    race.streams[i] = input.value = "";
    save();
    show();
  });
  show();

  slot.append(head, screen);
  return slot;
}

// the stream slots are only built once per race, so a stream isn't reloaded by every click
let streamsFor = "";
const streamButtons = [];

function renderStreams(race) {
  const wanted = race.mode === "ref" ? race.code : "";
  $("raceStreams").hidden = !wanted;
  if (wanted === streamsFor) return;
  streamsFor = wanted;
  race.streams ||= ["", ""];
  $("raceStreams").replaceChildren(...(wanted ? race.names.map((name, i) => streamSlot(race, i)) : []));

  const tools = [];
  if (wanted) {
    for (const { undo, hunted } of streamButtons) {
      const divider = document.createElement("i");
      tools.push(divider, undo, hunted);
    }
  }
  $("raceToolSlots").replaceChildren(...tools);
}

function refreshStreamButtons(race) {
  if (race.mode !== "ref") return;
  race.sides.forEach((side, i) => {
    const { undo, hunted, weapon, target } = streamButtons[i];
    const cell = race.lists[i][side.pos];
    const icon = cell && iconFor(cell.game, cell.name);
    undo.disabled = side.pos === 0;
    hunted.hidden = Boolean(side.finishedAt);
    weapon.replaceChildren();
    if (cell && cell.weapon) weapon.append(weaponBadge(cell.weapon));
    target.hidden = !icon;
    if (icon) {
      target.classList.toggle("px", cell.game === "gu" || cell.game === "frontier");
      target.title = cell.name;
      setSprite(target, icon);
    }
  });
}

function raceOver(race) {
  return race.sides.every((side) => side.finishedAt);
}

// a long monster name gets smaller type first, and wraps only if that isn't enough
function fitName(el) {
  for (const size of [15, 13, 12]) {
    el.style.fontSize = size + "px";
    if (el.scrollWidth <= el.clientWidth) return;
  }
  el.classList.add("wrap");
}

function renderRace() {
  const race = state.race;
  const screen = !race ? "raceLobby" : race.startedAt ? "raceRun" : "raceReady";
  for (const id of ["raceLobby", "raceReady", "raceRun"]) $(id).hidden = id !== screen;
  $("raceTools").hidden = !(screen === "raceRun" && race.mode === "ref");
  $("raceLink").hidden = !link;
  $("raceLink").textContent = link ? link.status : "";
  document.querySelector(".wrap").classList.toggle("broadcast", screen === "raceRun" && race.mode === "ref");

  if (screen === "raceLobby") {
    renderRaceLobby();
  } else if (screen === "raceReady") {
    renderRaceReady(race);
  } else {
    const live = race.sides.findIndex((side) => !side.finishedAt);
    const list = race.lists[Math.max(live, 0)];
    setBackdrop(list[Math.min(race.sides[Math.max(live, 0)].pos, list.length - 1)].game);
    $("raceRun").classList.toggle("wide", race.sides.length > 1);
    $("raceLabel").textContent = race.mode === "ref" ? "" : "Race " + race.code;
    $("raceRival").hidden = !race.rival;
    if (race.rival) $("raceRival").replaceChildren(rivalMarker(race));
    renderStreams(race);
    refreshStreamButtons(race);
    const ref = race.mode === "ref";
    $("raceQuit").hidden = ref;
    $("raceFoot").hidden = ref && !raceOver(race);
    $("raceSides").replaceChildren(...race.sides.map((side, i) => renderSide(race, i)));
    for (const name of document.querySelectorAll(".banner .tname")) fitName(name);
    $("raceCopy").hidden = $("raceAgain").hidden = !raceOver(race);
    tickRace();
  }
}

function tickRace() {
  const race = state.race;
  if (view !== "race" || !race || !race.startedAt) return;
  const end = raceOver(race) ? Math.max(...race.sides.map((side) => side.finishedAt)) : raceNow();
  $("raceTime").textContent = clock(end - race.startedAt);
}

function raceResultText() {
  const race = state.race;
  const lines = [];
  race.sides.forEach((side, i) => {
    lines.push(`${race.names[i]} finished race ${race.code} in ${clock(side.finishedAt - race.startedAt)}`);
    splitTimes(race, i).forEach((text, k) => lines.push(`${k + 1}. ${text}`));
  });
  return lines.join("\n");
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
  $("race").hidden = name !== "race";
  $("raceRival").hidden = $("raceLink").hidden = $("raceTools").hidden = true;
  if (name !== "race") document.querySelector(".wrap").classList.remove("broadcast");
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
  } else if (name === "race") {
    renderRace();
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
  const [sheet, stamp, paper, weaponSheet] = await Promise.all([
    loadImage(ICONS[game].sheet),
    loadImage("img/stamp-hunted.webp"),
    loadImage(paperFile),
    loadImage("img/weapons.webp"),
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

    if (cell.weapon) {
      const wi = WEAPONS.indexOf(cell.weapon);
      const r = size * 0.15;
      const cx = size * 0.04 + r;
      const cy = size * 0.96 - r;
      c.save();
      if (marked) c.globalAlpha = 0.45;
      c.fillStyle = "#2a180a";
      c.strokeStyle = "#f3e6c4";
      c.lineWidth = size * 0.012;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      if (wi >= 0 && weaponSheet) {
        const d = r * 1.5;
        c.drawImage(
          weaponSheet,
          (wi % 5) * 96,
          Math.floor(wi / 5) * 96,
          96,
          96,
          cx - d / 2,
          cy - d / 2,
          d,
          d,
        );
      } else {
        c.font = `700 ${size * 0.05}px ${bodyFont}`;
        c.fillStyle = "#f3e6c4";
        c.textAlign = "center";
        wrapText(c, cell.weapon, r * 1.7).forEach((text, k, all) => {
          c.fillText(text, cx, cy + (k - (all.length - 1) / 2) * size * 0.055);
        });
      }
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
$("mRace").addEventListener("click", () => showView("race"));
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
$("weapons").addEventListener("change", (e) => (state.weapons = e.target.checked));
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

$("raceHosting").addEventListener("click", () => {
  raceFlow = "host";
  raceStepTo("who");
});
$("raceJoining").addEventListener("click", () => {
  raceFlow = "join";
  raceStepTo("join");
});
$("raceBack").addEventListener("click", () => {
  const flow = RACE_FLOWS[raceFlow];
  const i = flow.indexOf(raceStep);
  if (i === 0) showView("menu");
  else raceStepTo(flow[i - 1]);
});
$("raceNext").addEventListener("click", () => {
  if (raceStep === "join") return joinRace();
  if (raceStep === "live") return hostRace();
  setBackdrop(state.raceSetup.games[0]);
  raceStepTo(raceStep === "who" ? "rules" : "live");
});
$("joinName").addEventListener("input", (e) => {
  state.raceName = e.target.value.trim();
  save();
});
for (const [id, field] of [
  ["roomAddress", "address"],
  ["roomSlot", "slot"],
  ["roomPassword", "password"],
]) {
  $(id).addEventListener("input", (e) => (state.raceSetup.room[field] = e.target.value.trim()));
}
["refName1", "refName2"].forEach((id, i) => {
  $(id).addEventListener("input", (e) => (state.raceSetup.names[i] = e.target.value.trim()));
});
$("rSpecial").addEventListener("input", (e) => {
  state.raceSetup.special = Number(e.target.value);
  $("rSpecialOut").textContent = state.raceSetup.special ? `${state.raceSetup.special}% of the race` : "None";
});
$("rWeapons").addEventListener("change", (e) => {
  state.raceSetup.weapons = e.target.checked;
  renderRaceLobby();
});
$("roomLink").addEventListener("click", () => navigator.clipboard.writeText("Bingo").catch(() => {}));
$("copySlot").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("Bingo");
    $("copySlot").textContent = "Copied";
    setTimeout(() => ($("copySlot").textContent = "Copy name again"), 1200);
  } catch (e) {}
});
$("raceStart").addEventListener("click", () => {
  state.race.startedAt = raceNow();
  saveRace();
});
for (const id of ["raceLeave", "raceQuit", "raceExit", "raceAgain"]) {
  $(id).addEventListener("click", () => {
    closeLink();
    state.race = null;
    streamsFor = "";
    $("raceStreams").replaceChildren();
    $("raceToolSlots").replaceChildren();
    raceStep = "role";
    save();
    renderRace();
  });
}
$("raceCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(raceResultText());
    $("raceCopy").textContent = "Copied";
    setTimeout(() => ($("raceCopy").textContent = "Copy result"), 1200);
  } catch (e) {}
});
setInterval(tickRace, 500);

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
openLink();
renderControls();
if (state.cells.length) renderBoard();
showView("menu");

function openInviteLink() {
  if (!location.hash.startsWith("#join=")) return;
  showView("race");
  if (!state.race) {
    raceFlow = "join";
    raceStepTo("join");
    $("raceCode").value = decodeURIComponent(location.hash.slice(6));
  }
  history.replaceState(null, "", location.pathname);
}
window.addEventListener("hashchange", openInviteLink);
openInviteLink();
