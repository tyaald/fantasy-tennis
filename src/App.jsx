import { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  DATA MODEL                                                         */
/* ------------------------------------------------------------------ */

const TOURNAMENTS = [
  { id: "ao",  name: "Australian Open", city: "Melbourne",     surface: "Hard court",  accent: "#2f6fb3", glow: "#3f8fd6" },
  { id: "iw",  name: "Indian Wells",    city: "Indian Wells",  surface: "Hard court",  accent: "#7d5fd0", glow: "#9b7ff0" },
  { id: "rg",  name: "Roland Garros",   city: "Paris",         surface: "Clay",        accent: "#c2562a", glow: "#e2733f" },
  { id: "wim", name: "Wimbledon",       city: "London",        surface: "Grass",       accent: "#2f8f4e", glow: "#43ad64" },
  { id: "uso", name: "US Open",         city: "New York",      surface: "Hard court",  accent: "#2787ad", glow: "#39a6d0" },
];

const YEARS = [2024, 2025, 2026, 2027];

// cap = the highest score this slot can earn (mirrors the MIN() caps in the sheet)
const CATEGORIES = [
  { key: "winner",   label: "Winner",          cap: null, outsideTop: null, hint: "Champion · up to 7" },
  { key: "runnerUp", label: "Runner-Up",       cap: 6,    outsideTop: null, hint: "Reached the final · max 6" },
  { key: "sf1",      label: "Semi-Finalist 1", cap: 5,    outsideTop: null, hint: "Final four · max 5" },
  { key: "sf2",      label: "Semi-Finalist 2", cap: 5,    outsideTop: null, hint: "Final four · max 5" },
  { key: "darkHorse",label: "Dark Horse",      cap: null, outsideTop: 10,   hint: "Outside the top 10 seeds" },
  { key: "longShot", label: "Long Shot",       cap: null, outsideTop: 20,   hint: "Outside the top 20 seeds" },
  { key: "dreamer",  label: "Dreamer",         cap: null, outsideTop: 30,   hint: "Outside the top 30 seeds" },
];

const MEN = [
  "Sinner","Alcaraz","Zverev","Djokovic","Fritz","Draper","Medvedev","Musetti","Rune","de Minaur",
  "Shelton","Tiafoe","Rublev","Paul","Ruud","Tsitsipas","Khachanov","Auger-Aliassime","Hurkacz","Mensik",
  "Cerundolo","Lehecka","Humbert","Cobolli","Machac","Fonseca","Tien","Michelsen","Nakashima","Korda",
  "Brooksby","Moutet","Shapovalov","Griekspoor","Norrie","Popyrin","Berrettini","Bublik","Monfils",
  "Perricard","Diallo","Etcheverry","Opelka","Fils","Kecmanovic","Nardi",
];

const WOMEN = [
  "Sabalenka","Swiatek","Gauff","Rybakina","Pegula","Andreeva","Navarro","Paolini","Muchova","Anisimova",
  "Keys","Svitolina","Zheng","Bencic","Kalinskaya","Alexandrova","Raducanu","Shnaider","Mertens","Vondrousova",
  "Ostapenko","Collins","Osaka","Badosa","Stearns","Eala","Townsend","Cirstea","Yastremska","Sakkari",
  "Noskova","Fernandez","Mboko","Kenin","Jovic","Tauson","Vekic","Krueger","Maria","Wang Xinyu",
  "Kostyuk","Frech","Kasatkina",
];

/* ------------------------------------------------------------------ */
/*  RECORD BOOKS  (historical titles, seeded from the spreadsheet)     */
/* ------------------------------------------------------------------ */

// The pool crowns a men's champion and a women's champion separately at each
// event — these are the title-holders recorded in the workbook's Record Books.
// Key = `${tournamentId}-${year}`. "Tyler" in the 2024 sheet is normalized to "Ty".
const CHAMPIONS_SEED = {
  "iw-2024":  { men: "Ty",             women: "Gucci Dumpling" },
  "rg-2024":  { men: "Gucci Dumpling", women: "In Vino Veritas" },
  "iw-2025":  { men: "Little t",       women: "In Vino Veritas" },
  "wim-2025": { men: "Gucci Dumpling", women: "Little t" },
  "uso-2025": { men: "Gucci Dumpling", women: "Seeing Eye Dog" },
  "ao-2026":  { men: "Seeing Eye Dog", women: "Seeing Eye Dog" },
  "iw-2026":  { men: "Triple fault",   women: "Tennis Savant" },
};

// Everyone in the pool, so the all-time board still shows players with no titles.
const PARTICIPANTS = [
  "Triple fault","Little t","Tennis Savant","Seeing Eye Dog","Gucci Dumpling",
  "In Vino Veritas","Ty","Charles","KP","G$","Godzilla",
];

// Real pool history pulled from the workbook. Baked in so the Pool, Enter results,
// and Standings tabs open populated. IW 2024 used an early 4-category format
// (Winner / Dark Horse / Long Shot / Dreamer), mapped here with the unused slots blank.
const PICKS_SEED = {
  "iw-2024": [
    { name: "Triple fault", men: { winner: "Sinner", runnerUp: "", sf1: "", sf2: "", darkHorse: "Davidovich Fokina", longShot: "Monfils", dreamer: "Wolf" }, women: { winner: "Q. Zheng", runnerUp: "", sf1: "", sf2: "", darkHorse: "Kalinskaya", longShot: "Y Wang", dreamer: "Radacanu" } },
    { name: "Little t", men: { winner: "Medvedev", runnerUp: "", sf1: "", sf2: "", darkHorse: "Norrie", longShot: "Wolf", dreamer: "Nadal" }, women: { winner: "Pegula", runnerUp: "", sf1: "", sf2: "", darkHorse: "Azarenka", longShot: "Stearns", dreamer: "Osaka" } },
    { name: "Tennis Savant", men: { winner: "Sinner", runnerUp: "", sf1: "", sf2: "", darkHorse: "Thompson", longShot: "Diaz Acosta", dreamer: "van de Zandschulp" }, women: { winner: "Swiatek", runnerUp: "", sf1: "", sf2: "", darkHorse: "Boulter", longShot: "Siniakova", dreamer: "Sasnovich" } },
    { name: "Seeing Eye Dog", men: { winner: "Sinner", runnerUp: "", sf1: "", sf2: "", darkHorse: "Norrie", longShot: "Machac", dreamer: "Seyboth Wild" }, women: { winner: "Rybakina", runnerUp: "", sf1: "", sf2: "", darkHorse: "Andreeva", longShot: "Kenin", dreamer: "Osaka" } },
    { name: "Gucci Dumpling", men: { winner: "Sinner", runnerUp: "", sf1: "", sf2: "", darkHorse: "Norrie", longShot: "Evans", dreamer: "Nadal" }, women: { winner: "Swaitek", runnerUp: "", sf1: "", sf2: "", darkHorse: "Azarenka", longShot: "Stephens", dreamer: "Raducanu" } },
    { name: "Ty", men: { winner: "Alcaraz", runnerUp: "", sf1: "", sf2: "", darkHorse: "Lehecka", longShot: "Kecmanovic", dreamer: "Nadal" }, women: { winner: "Gauff", runnerUp: "", sf1: "", sf2: "", darkHorse: "Azarenka", longShot: "Y. Wang", dreamer: "Volynets" } },
  ],
  "iw-2025": [
    { name: "Triple fault", men: { winner: "Zverev", runnerUp: "alcarez", sf1: "fritz", sf2: "tsitsipas", darkHorse: "shelton", longShot: "khachanov", dreamer: "opelka" }, women: { winner: "swiatek", runnerUp: "sabalenka", sf1: "paolini", sf2: "zheng", darkHorse: "badosa", longShot: "fernandez", dreamer: "radacanu" } },
    { name: "Little t", men: { winner: "Fritz", runnerUp: "Medvedev", sf1: "Shelton", sf2: "Alcaraz", darkHorse: "Tiafoe", longShot: "Shapovalov", dreamer: "Tien" }, women: { winner: "Gauff", runnerUp: "Pegula", sf1: "Navarro", sf2: "Swiatek", darkHorse: "Collins", longShot: "L Fernandez", dreamer: "Stearns" } },
    { name: "Tennis Savant", men: { winner: "Paul", runnerUp: "Alcaraz", sf1: "Zverev", sf2: "Rublev", darkHorse: "Draper", longShot: "Lehecka", dreamer: "Nakashima" }, women: { winner: "Pegula", runnerUp: "Keys", sf1: "Sabalenka", sf2: "Swiatek", darkHorse: "Badosa", longShot: "Svitolina", dreamer: "Noskova" } },
    { name: "Seeing Eye Dog", men: { winner: "Alcaraz", runnerUp: "Machac", sf1: "Fritz", sf2: "Paul", darkHorse: "Musetti", longShot: "Hurkacz", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "Keys", sf1: "Pegula", sf2: "Swiatek", darkHorse: "Anisimova", longShot: "Tauson", dreamer: "Kreuger" } },
    { name: "Gucci Dumpling", men: { winner: "Alcaraz", runnerUp: "Zverev", sf1: "Paul", sf2: "Fritz", darkHorse: "Auger Aliassime", longShot: "Korda", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "Swiatek", sf1: "Pegula", sf2: "Keys", darkHorse: "Badosa", longShot: "Svitolina", dreamer: "Kalinskaya" } },
    { name: "In Vino Veritas", men: { winner: "Alcaraz", runnerUp: "Zverev", sf1: "Ruud", sf2: "Fritz", darkHorse: "Draper", longShot: "Lehecka", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "Swiatek", sf1: "Andreeva", sf2: "Guaff", darkHorse: "Muchova", longShot: "Tauson", dreamer: "Osaka" } },
    { name: "Ty", men: { winner: "Zverev", runnerUp: "de Minaur", sf1: "Alcaraz", sf2: "Tsitsipas", darkHorse: "Shelton", longShot: "Cerundolo", dreamer: "Tien" }, women: { winner: "Sabalenka", runnerUp: "Rybakina", sf1: "Andreeva", sf2: "Gauff", darkHorse: "Badosa", longShot: "Svitolina", dreamer: "Kalinskaya" } },
    { name: "Julia", men: { winner: "Alcaraz", runnerUp: "Paul", sf1: "Fritz", sf2: "Shelton", darkHorse: "Hurckaz", longShot: "Korda", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "M Keys", sf1: "Rybakina", sf2: "Swiatek", darkHorse: "Collins", longShot: "Svitolina", dreamer: "Osaka" } },
  ],
  "wim-2025": [
    { name: "Little t", men: { winner: "Alcaraz", runnerUp: "Draper", sf1: "Sinner", sf2: "Musetti", darkHorse: "Paul", longShot: "Auger-Aliassime", dreamer: "Tien" }, women: { winner: "Gauff", runnerUp: "Sabalenka", sf1: "Navarro", sf2: "Swiatek", darkHorse: "Anisimova", longShot: "Kenin", dreamer: "Stearns" } },
    { name: "Tennis Savant", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Draper", sf2: "Zverev", darkHorse: "De Minaur", longShot: "Nakashima", dreamer: "Berrettini" }, women: { winner: "Sabalenka", runnerUp: "Pegula", sf1: "Zheng", sf2: "Gauff", darkHorse: "Anisimova", longShot: "Tauson", dreamer: "Eala" } },
    { name: "Seeing Eye Dog", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Fritz", sf2: "Bublik", darkHorse: "De Minaur", longShot: "Lehecka", dreamer: "Berrettini" }, women: { winner: "Vondrousova", runnerUp: "Pegula", sf1: "Rybakina", sf2: "Paolini", darkHorse: "Svitolina", longShot: "Vekic", dreamer: "Yastremska" } },
    { name: "Gucci Dumpling", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Djokovic", sf2: "Fritz", darkHorse: "Lehecka", longShot: "Bublik", dreamer: "Moutet" }, women: { winner: "Pegula", runnerUp: "Paolini", sf1: "Gauff", sf2: "Zheng", darkHorse: "Rybakina", longShot: "Vekic", dreamer: "Vondrousova" } },
    { name: "In Vino Veritas", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Djokovic", sf2: "Zverev", darkHorse: "De Minaur", longShot: "Bublik", dreamer: "Griekspoor" }, women: { winner: "Sabalenka", runnerUp: "Pegula", sf1: "Zheng", sf2: "Swiatek", darkHorse: "Rybakina", longShot: "Vekic", dreamer: "Maria" } },
    { name: "Ty", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Draper", sf2: "Zverev", darkHorse: "De Minaur", longShot: "Lehecka", dreamer: "Griekspoor" }, women: { winner: "Gauff", runnerUp: "Zheng", sf1: "Andreeva", sf2: "Sabalenka", darkHorse: "Muchova", longShot: "Tauson", dreamer: "Collins" } },
    { name: "Charles", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Draper", sf2: "Fritz", darkHorse: "Mensik", longShot: "Bublik", dreamer: "Berrettini" }, women: { winner: "Rybakina", runnerUp: "Sabalenka", sf1: "Gauff", sf2: "Swiatek", darkHorse: "Rybakina", longShot: "Ostapenko", dreamer: "Raducanu" } },
    { name: "KP", men: { winner: "Sinner", runnerUp: "Draper", sf1: "Alcaraz", sf2: "Djokovic", darkHorse: "Lehecka", longShot: "", dreamer: "" }, women: { winner: "", runnerUp: "", sf1: "", sf2: "", darkHorse: "", longShot: "", dreamer: "" } },
  ],
  "uso-2025": [
    { name: "Triple fault", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Shelton", sf2: "Zverev", darkHorse: "Rune", longShot: "Tsitsipas", dreamer: "Monfils" }, women: { winner: "Andreeva", runnerUp: "Swiatek", sf1: "Sabalenka", sf2: "Keys", darkHorse: "Tauson", longShot: "Fernandez", dreamer: "Radacanu" } },
    { name: "Little t", men: { winner: "Alcaraz", runnerUp: "Fritz", sf1: "Sinner", sf2: "Paul", darkHorse: "Paul", longShot: "Bublik", dreamer: "Perricard" }, women: { winner: "Gauff", runnerUp: "Navarro", sf1: "Swiatek", sf2: "Sabalenka", darkHorse: "Svitolina", longShot: "Osaka", dreamer: "Stearns" } },
    { name: "Tennis Savant", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "De Minaur", sf2: "Fritz", darkHorse: "Ruud", longShot: "Bublik", dreamer: "Norrie" }, women: { winner: "Swiatek", runnerUp: "Sabalenka", sf1: "Andreeva", sf2: "Paolini", darkHorse: "Tauson", longShot: "Mboko", dreamer: "Fernandez" } },
    { name: "Seeing Eye Dog", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Khachanov", sf2: "Rune", darkHorse: "Rublev", longShot: "Michelsen", dreamer: "Popyrin" }, women: { winner: "Swiatek", runnerUp: "Pegula", sf1: "Sabalenka", sf2: "Paolini", darkHorse: "Muchova", longShot: "Osaka", dreamer: "Townsend" } },
    { name: "Gucci Dumpling", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Fritz", sf2: "De Minaur", darkHorse: "Rublev", longShot: "Cobolli", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "Swiatek", sf1: "Gauff", sf2: "Andreeva", darkHorse: "Muchova", longShot: "Mboko", dreamer: "Raducanu" } },
    { name: "Ty", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Shelton", sf2: "Fritz", darkHorse: "Paul", longShot: "Tsitsipas", dreamer: "Diallo" }, women: { winner: "Gauff", runnerUp: "Sabalenka", sf1: "Swiatek", sf2: "Pegula", darkHorse: "Svitolina", longShot: "Kalinskaya", dreamer: "Fernandez" } },
    { name: "Charles", men: { winner: "Alcaraz", runnerUp: "Draper", sf1: "Zverev", sf2: "Djokovic", darkHorse: "Rune", longShot: "Bublik", dreamer: "Perricard" }, women: { winner: "Swiatek", runnerUp: "Sabalenka", sf1: "Rybakina", sf2: "Gauff", darkHorse: "Navarrro", longShot: "Ostapenko", dreamer: "Krueger" } },
  ],
  "ao-2026": [
    { name: "Triple fault", men: { winner: "Zverev", runnerUp: "Djokovic", sf1: "Shelton", sf2: "Sinner", darkHorse: "Medvedev", longShot: "Shapovalov", dreamer: "Tsitsipas" }, women: { winner: "Andreeva", runnerUp: "Swiatek", sf1: "Sabalenka", sf2: "Navarro", darkHorse: "Fernandez", longShot: "Raducanu", dreamer: "Vondrousova" } },
    { name: "Little t", men: { winner: "Alcaraz", runnerUp: "Musetti", sf1: "Shelton", sf2: "Zverev", darkHorse: "Paul", longShot: "Tien", dreamer: "Brooksby" }, women: { winner: "Gauff", runnerUp: "Sabalenka", sf1: "Navarro", sf2: "Pegula", darkHorse: "Mboko", longShot: "Kenin", dreamer: "Stearns" } },
    { name: "Tennis Savant", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "de Minaur", sf2: "Fritz", darkHorse: "Mensik", longShot: "Fonseca", dreamer: "Tsitsipas" }, women: { winner: "Sabalenka", runnerUp: "Rybakina", sf1: "Navarro", sf2: "Noskova", darkHorse: "Noskova", longShot: "Yastremska", dreamer: "Kalinskya" } },
    { name: "Seeing Eye Dog", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Zverev", sf2: "Musetti", darkHorse: "Mensik", longShot: "Tien", dreamer: "Hurkacz" }, women: { winner: "Anisimova", runnerUp: "Sabalenka", sf1: "Rybakina", sf2: "Swiatek", darkHorse: "Svitolina", longShot: "Jovic", dreamer: "Wang Xinyu" } },
    { name: "Gucci Dumpling", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Auger-Aliassime", sf2: "Musetti", darkHorse: "Medvedev", longShot: "Griekspoor", dreamer: "Popyrin" }, women: { winner: "Sabalenka", runnerUp: "Anisimova", sf1: "Andreeva", sf2: "Rybakina", darkHorse: "Alexandrova", longShot: "Mertens", dreamer: "Vondrousova" } },
    { name: "In Vino Veritas", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Medvedev", sf2: "Musetti", darkHorse: "Mensik", longShot: "Norrie", dreamer: "Tsitsipas" }, women: { winner: "Anisimova", runnerUp: "Gauff", sf1: "Sabalenka", sf2: "Rybakina", darkHorse: "Navarro", longShot: "Fernandez", dreamer: "Vondrousova" } },
    { name: "Ty", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Musetti", sf2: "Medvedev", darkHorse: "Medvedev", longShot: "Tien", dreamer: "Popyrin" }, women: { winner: "Anisimova", runnerUp: "Sabalenka", sf1: "Rybakina", sf2: "Gauff", darkHorse: "Alexandrova", longShot: "Fernandez", dreamer: "Vondrousova" } },
    { name: "Charles", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Auger-Aliassime", sf2: "Musetti", darkHorse: "Medvedev", longShot: "Tien", dreamer: "Berretini" }, women: { winner: "Anisimova", runnerUp: "Sabalenka", sf1: "Rybakina", sf2: "Swiatek", darkHorse: "Navarro", longShot: "Raducanu", dreamer: "Vondrousova" } },
    { name: "KP", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Zverev", sf2: "Musetti", darkHorse: "Rublev", longShot: "Tien", dreamer: "Tsitsipas" }, women: { winner: "Swiatek", runnerUp: "Anisimova", sf1: "Navarro", sf2: "Pegula", darkHorse: "Navarro", longShot: "Mertens", dreamer: "Stearns" } },
    { name: "G$", men: { winner: "Shelton", runnerUp: "Sinner", sf1: "Musetti", sf2: "Zverev", darkHorse: "Paul", longShot: "Shapovalov", dreamer: "Berretini" }, women: { winner: "Gauff", runnerUp: "Sabalenka", sf1: "Swiatek", sf2: "Rybakina", darkHorse: "Osaka", longShot: "Fernandez", dreamer: "Kalinskya" } },
  ],
  "iw-2026": [
    { name: "Triple fault", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Zverev", sf2: "Djokovic", darkHorse: "Medvedev", longShot: "Tiafoe", dreamer: "Korda" }, women: { winner: "Andreeva", runnerUp: "Sabalenka", sf1: "Gauff", sf2: "Pegula", darkHorse: "Alexandrova", longShot: "Radacanu", dreamer: "Badosa" } },
    { name: "Little t", men: { winner: "Shelton", runnerUp: "Fritz", sf1: "Alcaraz", sf2: "Sinner", darkHorse: "Tiafoe", longShot: "Tien", dreamer: "Brooksby" }, women: { winner: "Gauff", runnerUp: "Pegula", sf1: "Navarro", sf2: "Anisimova", darkHorse: "Keys", longShot: "Navarro", dreamer: "Stearns" } },
    { name: "Tennis Savant", men: { winner: "Sinner", runnerUp: "Alcaraz", sf1: "Djokovic", sf2: "Musetti", darkHorse: "Cobolli", longShot: "Lehecka", dreamer: "Moutet" }, women: { winner: "Rybakina", runnerUp: "Sabalenka", sf1: "Gauff", sf2: "Pegula", darkHorse: "Muchova", longShot: "Kalinskaya", dreamer: "Eala" } },
    { name: "Seeing Eye Dog", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Fritz", sf2: "Zverev", darkHorse: "Cobolli", longShot: "Fils", dreamer: "Korda" }, women: { winner: "Sabalenka", runnerUp: "Rybakina", sf1: "Muchova", sf2: "Paolini", darkHorse: "Bencic", longShot: "Shnaider", dreamer: "Townsend" } },
    { name: "Gucci Dumpling", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Auger-Aliassime", sf2: "Draper", darkHorse: "Mensik", longShot: "Tien", dreamer: "Michelsen" }, women: { winner: "Rybakina", runnerUp: "Sabalenka", sf1: "Gauff", sf2: "Swiatek", darkHorse: "Bencic", longShot: "Kalinskaya", dreamer: "Cirstea" } },
    { name: "In Vino Veritas", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Djokovic", sf2: "Musetti", darkHorse: "Cobolli", longShot: "Paul", dreamer: "Fonseca" }, women: { winner: "Sabalenka", runnerUp: "Rybakina", sf1: "Paolini", sf2: "Swiatek", darkHorse: "Muchova", longShot: "Shnaider", dreamer: "Yastremska" } },
    { name: "Ty", men: { winner: "Alcaraz", runnerUp: "Sinner", sf1: "Zverev", sf2: "Fritz", darkHorse: "Lehecka", longShot: "Tien", dreamer: "Moutet" }, women: { winner: "Sabalenka", runnerUp: "Rybakina", sf1: "Andreeva", sf2: "Gauff", darkHorse: "Alexandrova", longShot: "Kalinskaya", dreamer: "Cirstea" } },
    { name: "Charles", men: { winner: "Alcaraz", runnerUp: "Fritz", sf1: "Sinner", sf2: "Draper", darkHorse: "Mensik", longShot: "Tien", dreamer: "Fils" }, women: { winner: "Rybakina", runnerUp: "Andreeva", sf1: "Sabalenka", sf2: "Pegula", darkHorse: "Keys", longShot: "Navarro", dreamer: "Stearns" } },
    { name: "KP", men: { winner: "Sinner", runnerUp: "Musetti", sf1: "Auger-Aliassime", sf2: "Fritz", darkHorse: "Cerundolo", longShot: "Tien", dreamer: "Nakashima" }, women: { winner: "Swiatek", runnerUp: "Gauff", sf1: "Rybakina", sf2: "Anisimova", darkHorse: "Keys", longShot: "Navarro", dreamer: "Sakkari" } },
    { name: "G$", men: { winner: "Musetti", runnerUp: "Alcaraz", sf1: "Paul", sf2: "Shelton", darkHorse: "Tiafoe", longShot: "Korda", dreamer: "Humbert" }, women: { winner: "Pegula", runnerUp: "Sabalenka", sf1: "Gauff", sf2: "Svitolina", darkHorse: "Bencic", longShot: "Mertens", dreamer: "Sakkari" } },
  ],
};

// Match wins per picked player, per event (raw, uncapped — the app applies caps per event).
const RESULTS_SEED = {
  "iw-2024": { "Alcaraz": 6, "Andreeva": 0, "Azarenka": 0, "Boulter": 0, "Davidovich Fokina": 0, "Diaz Acosta": 0, "Evans": 0, "Gauff": 4, "Kalinskaya": 1, "Kecmanovic": 0, "Kenin": 0, "Lehecka": 3, "Machac": 1, "Medvedev": 5, "Monfils": 3, "Nadal": 0, "Norrie": 1, "Osaka": 2, "Pegula": 0, "Q. Zheng": 0, "Radacanu": 2, "Raducanu": 2, "Rybakina": 0, "Sasnovich": 0, "Seyboth Wild": 2, "Siniakova": 1, "Sinner": 4, "Stearns": 1, "Stephens": 2, "Swaitek": 6, "Swiatek": 6, "Thompson": 0, "Volynets": 2, "Wolf": 0, "Y Wang": 0, "Y. Wang": 0, "van de Zandschulp": 0 },
  "iw-2025": { "Alcaraz": 4, "Andreeva": 6, "Anisimova": 0, "Auger Aliassime": 0, "Badosa": 0, "Cerundolo": 3, "Collins": 1, "Draper": 6, "Fonseca": 1, "Fritz": 2, "Gauff": 2, "Guaff": 2, "Hurckaz": 1, "Hurkacz": 1, "Kalinskaya": 0, "Keys": 4, "Korda": 0, "Kreuger": 1, "L Fernandez": 0, "Lehecka": 0, "M Keys": 4, "Machac": 0, "Medvedev": 4, "Muchova": 2, "Musetti": 1, "Nakashima": 2, "Navarro": 1, "Noskova": 0, "Osaka": 0, "Paul": 2, "Pegula": 2, "Rublev": 0, "Ruud": 0, "Rybakina": 2, "Sabalenka": 5, "Shapovalov": 1, "Shelton": 3, "Stearns": 0, "Svitolina": 3, "Swiatek": 4, "Tauson": 1, "Tiafoe": 1, "Tien": 0, "Tsitsipas": 2, "Zverev": 0, "alcarez": 4, "badosa": 0, "de Minaur": 2, "fernandez": 0, "fritz": 2, "khachanov": 1, "opelka": 0, "paolini": 2, "radacanu": 0, "sabalenka": 5, "shelton": 3, "swiatek": 4, "tsitsipas": 2, "zheng": 3 },
  "wim-2025": { "Alcaraz": 6, "Andreeva": 4, "Anisimova": 6, "Auger-Aliassime": 1, "Berrettini": 0, "Bublik": 0, "Collins": 2, "De Minaur": 3, "Djokovic": 5, "Draper": 1, "Eala": 0, "Fritz": 5, "Gauff": 0, "Griekspoor": 0, "Kenin": 1, "Lehecka": 1, "Maria": 0, "Mensik": 2, "Moutet": 1, "Muchova": 0, "Musetti": 0, "Nakashima": 2, "Navarro": 3, "Ostapenko": 0, "Paolini": 1, "Paul": 1, "Pegula": 0, "Raducanu": 2, "Rybakina": 2, "Sabalenka": 5, "Sinner": 7, "Stearns": 0, "Svitolina": 2, "Swiatek": 7, "Tauson": 3, "Tien": 1, "Vekic": 1, "Vondrousova": 1, "Yastremska": 2, "Zheng": 0, "Zverev": 0 },
  "uso-2025": { "Alcaraz": 7, "Andreeva": 2, "Bublik": 3, "Cobolli": 2, "De Minaur": 4, "Diallo": 1, "Djokovic": 5, "Draper": 1, "Fernandez": 2, "Fonseca": 1, "Fritz": 4, "Gauff": 3, "Kalinskaya": 2, "Keys": 0, "Khachanov": 1, "Krueger": 1, "Mboko": 0, "Michelsen": 0, "Monfils": 0, "Muchova": 4, "Navarro": 2, "Navarrro": 2, "Norrie": 2, "Osaka": 5, "Ostapenko": 1, "Paolini": 2, "Paul": 2, "Pegula": 5, "Perricard": 0, "Popyrin": 1, "Radacanu": 2, "Raducanu": 2, "Rublev": 3, "Rune": 1, "Ruud": 1, "Rybakina": 3, "Sabalenka": 7, "Shelton": 2, "Sinner": 6, "Stearns": 1, "Svitolina": 0, "Swiatek": 4, "Tauson": 0, "Townsend": 3, "Tsitsipas": 1, "Zverev": 2 },
  "ao-2026": { "Alcaraz": 7, "Alexandrova": 0, "Andreeva": 3, "Anisimova": 4, "Auger-Aliassime": 0, "Berretini": 0, "Brooksby": 0, "Djokovic": 6, "Fernandez": 0, "Fonseca": 0, "Fritz": 3, "Gauff": 4, "Griekspoor": 0, "Hurkacz": 1, "Jovic": 4, "Kalinskya": 2, "Kenin": 0, "Mboko": 3, "Medvedev": 3, "Mensik": 3, "Mertens": 3, "Musetti": 4, "Navarro": 0, "Norrie": 2, "Noskova": 2, "Osaka": 2, "Paul": 3, "Pegula": 5, "Popyrin": 0, "Raducanu": 1, "Rublev": 2, "Rybakina": 7, "Sabalenka": 6, "Shapovalov": 1, "Shelton": 4, "Sinner": 5, "Stearns": 2, "Svitolina": 5, "Swiatek": 4, "Tien": 4, "Tsitsipas": 1, "Vondrousova": 0, "Wang Xinyu": 3, "Yastremska": 0, "Zverev": 5, "de Minaur": 4 },
  "iw-2026": { "Alcaraz": 5, "Alexandrova": 1, "Andreeva": 2, "Anisimova": 3, "Auger-Aliassime": 3, "Badosa": 0, "Bencic": 3, "Brooksby": 1, "Cerundolo": 2, "Cirstea": 2, "Cobolli": 2, "Djokovic": 3, "Draper": 4, "Eala": 3, "Fils": 4, "Fonseca": 3, "Fritz": 2, "Gauff": 2, "Humbert": 1, "Kalinskaya": 2, "Keys": 2, "Korda": 1, "Lehecka": 1, "Medvedev": 6, "Mensik": 2, "Mertens": 2, "Michelsen": 3, "Moutet": 1, "Muchova": 3, "Musetti": 1, "Nakashima": 2, "Navarro": 1, "Paolini": 3, "Paul": 2, "Pegula": 4, "Radacanu": 2, "Rybakina": 6, "Sabalenka": 6, "Sakkari": 2, "Shelton": 2, "Shnaider": 1, "Sinner": 7, "Stearns": 0, "Svitolina": 5, "Swiatek": 4, "Tiafoe": 3, "Tien": 4, "Townsend": 1, "Yastremska": 1, "Zverev": 5 },
};

// Caps (Runner-Up 6, Semis 5) only apply to events scored under the current template.
// These legacy events were scored with no caps in the sheet; capping them would change
// recorded champions, so they stay uncapped. New/future events default to capped.
const UNCAPPED_EVENTS = new Set(["iw-2024", "iw-2025", "wim-2025", "uso-2025", "ao-2026"]);

/* ------------------------------------------------------------------ */
/*  STORAGE  (shared so a whole group uses one pool; in-memory fallback)*/
/* ------------------------------------------------------------------ */

// Shared pool storage, backed by a Cloudflare KV namespace via the /api/kv function.
// All data is global (one shared pool), matching the original design. Failures degrade
// gracefully to null/empty so the seeded history still renders if the API is unreachable.
const KV_API = "/api/kv";
const store = {
  async get(key) {
    try {
      const r = await fetch(`${KV_API}?key=${encodeURIComponent(key)}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.value ?? null;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      const r = await fetch(KV_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      return r.ok;
    } catch { return false; }
  },
  async del(key) {
    try { await fetch(`${KV_API}?key=${encodeURIComponent(key)}`, { method: "DELETE" }); } catch { /* ignore */ }
  },
  async listKeys(prefix) {
    try {
      const r = await fetch(`${KV_API}?prefix=${encodeURIComponent(prefix)}`);
      if (!r.ok) return [];
      const d = await r.json();
      return d.keys || [];
    } catch { return []; }
  },
};

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const eventKey = (tid, yr) => `${tid}-${yr}`;
const pickKey = (ek, name) => `picks:${ek}:${slug(name)}`;
const resultsKey = (ek) => `results:${ek}`;
const championsKey = () => `champions`; // one shared ledger across all events

const safeParse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

// Name normalizer — MUST match the one in functions/api/results.js so scraped keys line up.
const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/-/g, " ").replace(/[^a-z\s']/g, "").replace(/\s+/g, " ").trim();

// Match a pick (usually a surname) to a scraped { normFullName: {name, wins} } map.
// Returns the hit, or null if nothing matches or it's ambiguous (two different players).
const matchScraped = (pickName, scrapedPlayers) => {
  const p = norm(pickName);
  if (!p) return null;
  const pLast = p.split(" ").pop();
  let hit = null, ambiguous = false;
  for (const k in scrapedPlayers) {
    const last = k.split(" ").pop();
    const ok = k === p || last === pLast || k.endsWith(" " + p) || p.endsWith(" " + last);
    if (ok) {
      if (hit && norm(hit.name) !== norm(scrapedPlayers[k].name)) ambiguous = true;
      hit = scrapedPlayers[k];
    }
  }
  return ambiguous ? null : hit;
};

const scoreFor = (matchWins, cap, useCaps = true) => {
  const w = Number(matchWins) || 0;
  return (useCaps && cap != null) ? Math.min(w, cap) : w;
};
const emptyPicks = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, ""]));

/* ------------------------------------------------------------------ */
/*  COMBOBOX                                                           */
/* ------------------------------------------------------------------ */

function PlayerSelect({ value, onChange, roster, seeds, outsideTop, accent, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const seedOf = (name) => (seeds ? seeds[name] : undefined);
  const eligible = (name) => {
    if (!outsideTop) return true;
    const sd = seedOf(name);
    return sd == null || sd > outsideTop;
  };

  const term = q.trim().toLowerCase();
  const matches = roster.filter((p) => p.toLowerCase().includes(term)).slice(0, 10);
  const showAdd = term && !roster.some((p) => p.toLowerCase() === term) && eligible(q.trim());

  const choose = (name) => {
    if (!eligible(name)) return;
    onChange(name); setQ(""); setOpen(false);
  };

  const valueBad = value && !eligible(value);

  return (
    <div className="combo" ref={wrapRef}>
      <button
        type="button"
        className={"combo-trigger" + (value ? " filled" : "") + (valueBad ? " bad" : "")}
        onClick={() => setOpen((o) => !o)}
        style={value && !valueBad ? { borderColor: accent } : undefined}
        title={valueBad ? `Seeded #${seedOf(value)} — not eligible for this slot` : undefined}
      >
        <span className={value ? "" : "combo-ph"}>
          {value || placeholder}
          {value && seedOf(value) != null && <span className="seed-badge">#{seedOf(value)}</span>}
        </span>
        {value ? (
          <span className="combo-clear" onClick={(e) => { e.stopPropagation(); onChange(""); }}>✕</span>
        ) : (
          <span className="combo-caret">▾</span>
        )}
      </button>
      {open && (
        <div className="combo-pop">
          <input
            className="combo-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={outsideTop ? `Search · outside top ${outsideTop} seeds` : "Search or type a name…"}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && eligible(q.trim())) choose(q.trim()); }}
          />
          <div className="combo-list">
            {matches.map((p) => {
              const sd = seedOf(p);
              const ok = eligible(p);
              return (
                <div
                  key={p}
                  className={"combo-opt" + (ok ? "" : " blocked")}
                  onClick={() => ok && choose(p)}
                  title={ok ? undefined : `Seeded #${sd} — too high for this slot`}
                >
                  <span>{p}</span>
                  {sd != null && <span className={"seed-badge" + (ok ? "" : " block")}>#{sd}</span>}
                </div>
              );
            })}
            {showAdd && (
              <div className="combo-opt combo-add" onClick={() => choose(q.trim())}>
                + Use “{q.trim()}”
              </div>
            )}
            {!matches.length && !showAdd && <div className="combo-empty">Start typing a name</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MAIN                                                               */
/* ------------------------------------------------------------------ */

export default function TennisPool() {
  const [tid, setTid] = useState("iw");
  const [year, setYear] = useState(2026);
  const [tab, setTab] = useState("picks");
  const [boardView, setBoardView] = useState("overall"); // men | women | overall

  const tour = TOURNAMENTS.find((t) => t.id === tid);
  const ek = eventKey(tid, year);

  // picks form
  const [name, setName] = useState("");
  const [men, setMen] = useState(emptyPicks);
  const [women, setWomen] = useState(emptyPicks);
  const [saveMsg, setSaveMsg] = useState("");

  // pool + results
  const [pool, setPool] = useState([]);          // [{name, men, women, slug}]
  const [results, setResults] = useState({});    // {playerName: wins}
  const [champions, setChampions] = useState(CHAMPIONS_SEED); // {ek: {men, women}}
  const [crownMsg, setCrownMsg] = useState("");
  const [loading, setLoading] = useState(false);
  // auto-fetch results via Claude web search
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [fetchMsg, setFetchMsg] = useState("");
  const [proposed, setProposed] = useState(null); // {pickName: wins|null} awaiting confirmation
  const [autoRefresh, setAutoRefresh] = useState(false); // auto-check for results on load
  const [editScores, setEditScores] = useState(false); // inline manual results editor
  const [eventRoster, setEventRoster] = useState(null); // {men:[], women:[]} pulled from the draw
  const [drawLoading, setDrawLoading] = useState(false);
  const [drawError, setDrawError] = useState("");
  const [drawMsg, setDrawMsg] = useState("");
  const didFetchDraw = useRef({}); // {ek: true} — one draw fetch per event per session
  const didAutoFetch = useRef({}); // {ek: true} — one auto-fetch per event per session

  const loadEvent = useCallback(async () => {
    setLoading(true);
    const keys = await store.listKeys(`picks:${ek}:`);
    const records = [];
    for (const k of keys) {
      const raw = await store.get(k);
      if (raw) { try { records.push(JSON.parse(raw)); } catch {} }
    }
    records.sort((a, b) => a.name.localeCompare(b.name));
    // baked-in history is always present; live (stored) entries are added on top
    const seeded = PICKS_SEED[ek] || [];
    const seededSlugs = new Set(seeded.map((p) => slug(p.name)));
    const live = records.filter((p) => !seededSlugs.has(slug(p.name)));
    setPool([...seeded, ...live].sort((a, b) => a.name.localeCompare(b.name)));
    const r = await store.get(resultsKey(ek));
    setResults({ ...(RESULTS_SEED[ek] || {}), ...(r ? safeParse(r, {}) : {}) });
    const c = await store.get(championsKey());
    setChampions({ ...CHAMPIONS_SEED, ...(c ? safeParse(c, {}) : {}) });
    const ar = await store.get("autoRefresh");
    setAutoRefresh(ar !== "0"); // on by default; only off if the user turned it off
    const rj = await store.get(`roster:${ek}`);
    setEventRoster(rj ? safeParse(rj, null) : null);
    setLoading(false);
  }, [ek]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  // load my own picks into the form when event/name changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!name.trim()) return;
      const raw = await store.get(pickKey(ek, name));
      if (cancelled) return;
      if (raw) { try { const p = JSON.parse(raw); setMen({ ...emptyPicks(), ...p.men }); setWomen({ ...emptyPicks(), ...p.women }); } catch {} }
    })();
    return () => { cancelled = true; };
  }, [ek]); // eslint-disable-line

  const setPick = (side, key, val) =>
    side === "men" ? setMen((p) => ({ ...p, [key]: val })) : setWomen((p) => ({ ...p, [key]: val }));

  const filledCount = [...Object.values(men), ...Object.values(women)].filter(Boolean).length;

  const savePicks = async () => {
    if (!name.trim()) { setSaveMsg("Add your name first."); return; }
    const rec = { name: name.trim(), men, women, updatedAt: Date.now() };
    const ok = await store.set(pickKey(ek, name), JSON.stringify(rec));
    setSaveMsg(ok ? `Picks locked in for ${tour.name} ${year}.` : "Couldn't save — try again.");
    await loadEvent();
    setTimeout(() => setSaveMsg(""), 3500);
  };

  const loadMine = async () => {
    if (!name.trim()) { setSaveMsg("Add your name to load your picks."); setTimeout(() => setSaveMsg(""), 2500); return; }
    const raw = await store.get(pickKey(ek, name));
    if (raw) { try { const p = JSON.parse(raw); setMen({ ...emptyPicks(), ...p.men }); setWomen({ ...emptyPicks(), ...p.women }); setSaveMsg("Loaded your saved picks."); } catch {} }
    else setSaveMsg("No saved picks for that name yet.");
    setTimeout(() => setSaveMsg(""), 2500);
  };

  // distinct players picked, per gender — drives the results screen
  const pickedPlayers = (side) => {
    const set = new Set();
    pool.forEach((r) => Object.values(r[side] || {}).forEach((v) => v && set.add(v)));
    return [...set].sort((a, b) => a.localeCompare(b));
  };

  const saveResult = async (player, wins) => {
    const next = { ...results, [player]: wins };
    setResults(next);
    await store.set(resultsKey(ek), JSON.stringify(next));
  };

  const pickedAll = [...new Set([...pickedPlayers("men"), ...pickedPlayers("women")])];

  // Pull completed results for this event via Claude + web search, then let the user confirm.
  const fetchResults = async (auto = false) => {
    setFetchError(""); setFetchMsg(""); setProposed(null);
    if (!pickedAll.length) { if (!auto) setFetchError("No picks to score yet."); return; }
    setFetching(true);

    // Apply a { pickName: wins } map. Auto = silently apply new/higher counts, flag drops
    // to confirm. Manual = show the full review.
    const applyCleaned = async (cleaned) => {
      if (!cleaned || !Object.keys(cleaned).length) throw new Error("No results found.");
      if (auto) {
        const next = { ...results };
        const conflicts = {};
        let applied = 0;
        Object.entries(cleaned).forEach(([p, w]) => {
          if (w == null || !Number.isFinite(Number(w))) return;
          const nw = Number(w);
          const cur = results[p];
          const hasCur = cur !== "" && cur != null && Number.isFinite(Number(cur));
          if (!hasCur || nw > Number(cur)) { next[p] = nw; applied++; }
          else if (nw < Number(cur)) { conflicts[p] = nw; }
        });
        if (applied) { setResults(next); await store.set(resultsKey(ek), JSON.stringify(next)); }
        setProposed(Object.keys(conflicts).length ? conflicts : null);
        if (applied) { setFetchMsg(`Auto-updated ${applied} result${applied === 1 ? "" : "s"}.`); setTimeout(() => setFetchMsg(""), 4000); }
      } else {
        setProposed(cleaned);
      }
    };

    // 1) Free path: scrape ESPN's JSON, match scraped winners to picks by surname.
    const viaEspn = async () => {
      const r = await fetch(`/api/results?name=${encodeURIComponent(tour.name)}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d || !d.players || !Object.keys(d.players).length) return null;
      const cleaned = {};
      pickedAll.forEach((p) => { const hit = matchScraped(p, d.players); if (hit) cleaned[p] = hit.wins; });
      return Object.keys(cleaned).length ? cleaned : null;
    };

    // 2) Paid fallback: ask Claude, only if the scrape returned nothing usable.
    const viaClaude = async () => {
      const prompt =
`Find the official COMPLETED singles results for the ${tour.name} ${year} tennis tournament — both the men's (ATP) and women's (WTA) singles draws.

For each name in the list below, determine how many singles matches that player WON in that specific event (their raw "match wins"). The champion has the most (for example 7 at a Grand Slam, fewer at a smaller event); a first-round loser has 0. Names may be misspelled or last-name only — resolve them to the real player. If the event has not finished or you cannot determine a player's result, use null.

Players: ${JSON.stringify(pickedAll)}

Respond with ONLY a JSON object — no prose, no markdown fences. Keys must be EXACTLY the strings from the list above (preserve their original spelling). Values are the integer match-win count, or null if unknown.`;
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (data?.type === "error") throw new Error(data.error?.message || "API error");
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      if (s === -1 || e === -1) throw new Error("No results found in the response.");
      const obj = JSON.parse(text.slice(s, e + 1));
      const cleaned = {};
      pickedAll.forEach((p) => { if (p in obj) cleaned[p] = obj[p]; });
      return Object.keys(cleaned).length ? cleaned : null;
    };

    try {
      let cleaned = null;
      try { cleaned = await viaEspn(); } catch { cleaned = null; }
      if (!cleaned) cleaned = await viaClaude(); // paid fallback only when the free scrape misses
      await applyCleaned(cleaned);
      await store.set(`fetchedAt:${ek}`, String(Date.now()));
    } catch (err) {
      if (!auto) setFetchError(err.message || "Couldn't fetch results. You can still enter them by hand.");
    } finally {
      setFetching(false);
    }
  };

  const applyProposed = async () => {
    if (!proposed) return;
    const next = { ...results };
    let n = 0;
    Object.entries(proposed).forEach(([p, w]) => {
      if (w != null && Number.isFinite(Number(w))) { next[p] = Number(w); n++; }
    });
    setResults(next);
    await store.set(resultsKey(ek), JSON.stringify(next));
    setProposed(null);
    setFetchMsg(`Applied ${n} result${n === 1 ? "" : "s"}. Standings updated.`);
    setTimeout(() => setFetchMsg(""), 3500);
  };

  const setAuto = async (on) => {
    setAutoRefresh(on);
    await store.set("autoRefresh", on ? "1" : "0");
  };

  // Pull the full singles field/draw for this event so picks can be made from real entrants.
  const fetchDraw = async (auto = false) => {
    setDrawError(""); setDrawMsg(""); setDrawLoading(true);
    const ask = async (label) => {
      const prompt =
`List every player in the ${label} singles MAIN DRAW of the ${tour.name} ${year} tennis tournament. If the official draw is not out yet, use the confirmed entry list (the field).

For seeded players, use the SEED NUMBER the tournament assigned in THIS event's draw (usually 1–32) — NOT the player's ATP/WTA world ranking. These often differ when higher-ranked players are absent; always use the draw's seeding.

Respond with ONLY a JSON array of strings, one per player. Prefix a seeded player's name with their seed number and a pipe, e.g. "5|Rune". Unseeded players are just the name, e.g. "Brooksby". Use surname only, or "F. Surname" to disambiguate. No prose, no markdown. Example: ["1|Alcaraz","2|Sinner","Brooksby","Mpetshi Perricard"]`;
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (data?.type === "error") throw new Error(data.error?.message || "API error");
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const a = text.indexOf("["), b = text.lastIndexOf("]");
      if (a === -1 || b === -1) return { names: [], seeds: {} };
      let arr; try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return { names: [], seeds: {} }; }
      if (!Array.isArray(arr)) return { names: [], seeds: {} };
      const names = []; const seeds = {};
      arr.forEach((entry) => {
        if (typeof entry !== "string") return;
        const m = /^\s*(\d{1,2})\s*\|\s*(.+)$/.exec(entry);
        const nm = (m ? m[2] : entry).trim();
        if (!nm) return;
        if (!names.includes(nm)) names.push(nm);
        if (m) seeds[nm] = Number(m[1]);
      });
      names.sort((x, y) => x.localeCompare(y));
      return { names, seeds };
    };
    try {
      const [m, w] = await Promise.all([ask("men's (ATP)"), ask("women's (WTA)")]);
      if (!m.names.length && !w.names.length) throw new Error("No draw or entry list found yet for this event.");
      const roster = { men: m.names, women: w.names, menSeeds: m.seeds, womenSeeds: w.seeds };
      setEventRoster(roster);
      await store.set(`roster:${ek}`, JSON.stringify(roster));
      const seeded = Object.keys(m.seeds).length + Object.keys(w.seeds).length;
      setDrawMsg(`Loaded ${m.names.length} men + ${w.names.length} women (${seeded} seeded).`);
      setTimeout(() => setDrawMsg(""), 4000);
    } catch (err) {
      if (!auto) setDrawError(err.message || "Couldn't load the draw.");
    } finally {
      setDrawLoading(false);
    }
  };

  // Auto-load the field on first visit to an event that has no picks yet and no cached roster.
  useEffect(() => {
    if (loading || drawLoading || eventRoster || pool.length) return;
    if (didFetchDraw.current[ek]) return;
    didFetchDraw.current[ek] = true;
    fetchDraw(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ek, pool, eventRoster, loading]);

  // Auto-check for results on event load (once per session per event), de-duped to
  // avoid redundant calls on rapid reloads.
  const AUTO_THROTTLE_MS = 15 * 60 * 1000;
  useEffect(() => {
    if (!autoRefresh || loading || fetching || proposed) return;
    if (!pool.length || !pickedAll.length) return;
    if (didAutoFetch.current[ek]) return;
    didAutoFetch.current[ek] = true;
    (async () => {
      const ts = await store.get(`fetchedAt:${ek}`);
      const fresh = ts && Date.now() - Number(ts) < AUTO_THROTTLE_MS;
      if (!fresh) fetchResults(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, loading, ek, pool]);

  // standings — caps apply only to template-era events (legacy events scored uncapped)
  const capsApply = !UNCAPPED_EVENTS.has(ek);
  const sideScore = (picks) =>
    CATEGORIES.reduce((sum, c) => sum + scoreFor(results[picks[c.key]], c.cap, capsApply), 0);

  const standings = pool
    .map((r) => {
      const m = sideScore(r.men || {});
      const w = sideScore(r.women || {});
      return { ...r, men_pts: m, women_pts: w, total: m + w };
    })
    .sort((a, b) => b.total - a.total);

  const menRanked = [...standings].sort((a, b) => b.men_pts - a.men_pts);
  const womenRanked = [...standings].sort((a, b) => b.women_pts - a.women_pts);
  const rankedFor = (view) => (view === "men" ? menRanked : view === "women" ? womenRanked : standings);

  // a side champion is the highest scorer on that draw, but only once results exist
  const sideLeader = (field) => {
    if (!standings.length) return null;
    const top = standings.reduce((a, b) => (b[field] > a[field] ? b : a));
    if (top[field] <= 0) return null;
    const tied = standings.filter((r) => r[field] === top[field]).map((r) => r.name);
    return { name: top.name, pts: top[field], tied };
  };
  const menChamp = sideLeader("men_pts");
  const womenChamp = sideLeader("women_pts");
  const recorded = champions[ek] || null;

  const crownChampions = async () => {
    if (!menChamp && !womenChamp) { setCrownMsg("Enter some results first."); setTimeout(() => setCrownMsg(""), 2500); return; }
    const entry = {
      men: menChamp ? menChamp.name : (recorded?.men || ""),
      women: womenChamp ? womenChamp.name : (recorded?.women || ""),
    };
    const next = { ...champions, [ek]: entry };
    setChampions(next);
    await store.set(championsKey(), JSON.stringify(next));
    setCrownMsg(`Recorded for ${tour.name} ${year}.`);
    setTimeout(() => setCrownMsg(""), 3000);
  };

  // all-time title tally, derived from the champions ledger
  const titleBoard = (() => {
    const t = {};
    PARTICIPANTS.forEach((p) => { t[p] = { name: p, men: 0, women: 0 }; });
    Object.values(champions).forEach(({ men, women }) => {
      if (men)   { (t[men]   = t[men]   || { name: men,   men: 0, women: 0 }).men   += 1; }
      if (women) { (t[women] = t[women] || { name: women, men: 0, women: 0 }).women += 1; }
    });
    return Object.values(t)
      .map((x) => ({ ...x, total: x.men + x.women }))
      .sort((a, b) => b.total - a.total || b.men - a.men || a.name.localeCompare(b.name));
  })();

  // champions ledger grouped by year, newest first
  const ledger = (() => {
    const byYear = {};
    Object.entries(champions).forEach(([key, v]) => {
      const i = key.lastIndexOf("-");
      const id = key.slice(0, i), yr = key.slice(i + 1);
      const meta = TOURNAMENTS.find((t) => t.id === id);
      if (!meta) return;
      (byYear[yr] = byYear[yr] || []).push({ ...v, meta });
    });
    return Object.keys(byYear)
      .sort((a, b) => Number(b) - Number(a))
      .map((yr) => ({
        year: yr,
        events: byYear[yr].sort(
          (a, b) => TOURNAMENTS.indexOf(a.meta) - TOURNAMENTS.indexOf(b.meta)
        ),
      }));
  })();

  const accent = tour.accent;
  const rootStyle = { "--accent": accent, "--glow": tour.glow };

  return (
    <div className="tp-root" style={rootStyle}>
      <style>{CSS}</style>

      {/* ---------- HEADER / SCOREBOARD ---------- */}
      <header className="tp-head">
        <div className="court-lines" aria-hidden />
        <div className="head-inner">
          <div className="eyebrow">Grand Slam Prediction Pool</div>
          <h1 className="title">{tour.name}</h1>
          <div className="meta">
            <span>{tour.city}</span><i>·</i><span>{tour.surface}</span><i>·</i><span>{year}</span>
          </div>
        </div>
      </header>

      {/* ---------- EVENT PICKER ---------- */}
      <div className="event-bar">
        <div className="chips">
          {TOURNAMENTS.map((t) => (
            <button
              key={t.id}
              className={"chip" + (t.id === tid ? " active" : "")}
              onClick={() => setTid(t.id)}
              style={t.id === tid ? { background: t.accent, borderColor: t.accent } : { borderColor: t.accent, color: t.accent }}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="year-sel">
          {YEARS.map((y) => (
            <button key={y} className={"yr" + (y === year ? " active" : "")} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
      </div>

      {/* ---------- TABS ---------- */}
      <nav className="tabs">
        {[["picks","Make picks"],["board","Standings"],["records","Record Books"],["invite","Join & Notify"]].map(([id,lbl]) => (
          <button key={id} className={"tab" + (tab === id ? " active" : "")} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </nav>

      <main className="tp-main">
        {/* ============ MAKE PICKS ============ */}
        {tab === "picks" && (
          <section>
            <div className="namebar">
              <input className="name-input" placeholder="Your name (or team handle)" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="ghost" onClick={loadMine}>Load my picks</button>
              <div className="counter">{filledCount}/14 selected</div>
            </div>

            <div className="draw-bar">
              <button className="ghost" onClick={() => fetchDraw(false)} disabled={drawLoading}>
                {drawLoading ? "Loading field…" : "⟳ Load field from draw"}
              </button>
              <span className="muted small">
                {eventRoster
                  ? `Field: ${eventRoster.men?.length || 0} men · ${eventRoster.women?.length || 0} women from the draw.`
                  : "Using a default shortlist of top players — load the draw to pick from the full field."}
              </span>
              {drawError && <span className="fetch-err">{drawError}</span>}
              {drawMsg && <span className="save-msg">{drawMsg}</span>}
            </div>

            <div className="boards">
              {[["men","Men’s draw"],["women","Women’s draw"]].map(([side, heading]) => {
                const picks = side === "men" ? men : women;
                const roster = eventRoster?.[side]?.length ? eventRoster[side] : (side === "men" ? MEN : WOMEN);
                const seeds = side === "men" ? eventRoster?.menSeeds : eventRoster?.womenSeeds;
                return (
                  <div className="board" key={side}>
                    <div className="board-head"><span className="dot" />{heading}</div>
                    {CATEGORIES.map((c) => (
                      <div className="pick-row" key={c.key}>
                        <div className="pick-label">
                          <span className="pl-main">{c.label}</span>
                          <span className="pl-hint">{c.hint}</span>
                        </div>
                        <PlayerSelect
                          value={picks[c.key]}
                          onChange={(v) => setPick(side, c.key, v)}
                          roster={roster}
                          seeds={seeds}
                          outsideTop={c.outsideTop}
                          accent={accent}
                          placeholder="Select player"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="save-bar">
              <button className="primary" onClick={savePicks}>Lock in picks</button>
              {saveMsg && <span className="save-msg">{saveMsg}</span>}
            </div>
            <p className="scoring-note">
              Scoring follows the spreadsheet: each pick earns points equal to that player’s match wins at the event.
              Runner-Up caps at 6, Semi-Finalists at 5, and Winner / Dark Horse / Long Shot / Dreamer are uncapped.
            </p>
          </section>
        )}

        {/* ============ STANDINGS (pool + leaderboard, by draw) ============ */}
        {tab === "board" && (
          <section>
            <h2 className="sec-title">Standings · {tour.name} {year}</h2>

            <div className="seg" role="tablist">
              {[["men","Men"],["women","Women"],["overall","Overall"]].map(([id,lbl]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={boardView === id}
                  className={"seg-btn" + (boardView === id ? " active" : "")}
                  onClick={() => setBoardView(id)}
                >{lbl}</button>
              ))}
            </div>

            {loading && <p className="muted">Loading…</p>}
            {!loading && !pool.length && (
              <div className="empty">No picks yet. Be the first — head to <b>Make picks</b>.</div>
            )}

            {pool.length > 0 && (
              <AutoFetchPanel
                tourName={tour.name} year={year}
                fetching={fetching} error={fetchError} msg={fetchMsg}
                proposed={proposed} pickedAll={pickedAll} results={results}
                autoRefresh={autoRefresh} onToggleAuto={setAuto}
                onFetch={() => fetchResults(false)} onApply={applyProposed} onDismiss={() => setProposed(null)}
                editing={editScores} onToggleEdit={() => setEditScores((v) => !v)}
              />
            )}

            {pool.length > 0 && editScores && (
              <div className="results-cols">
                {[["men","Men"],["women","Women"]].map(([side,lbl]) => {
                  const players = pickedPlayers(side);
                  return (
                    <div className="res-col" key={side}>
                      <div className="res-head">{lbl}</div>
                      {!players.length && <div className="muted small">No picks on this side.</div>}
                      {players.map((p) => (
                        <div className="res-row" key={p}>
                          <span className="res-name">{p}</span>
                          <input
                            className="wins-input"
                            type="number" min="0" max="7"
                            value={results[p] ?? ""}
                            placeholder="0"
                            onChange={(e) => saveResult(p, e.target.value === "" ? "" : Number(e.target.value))}
                          />
                          <span className="res-unit">wins</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* champions */}
            {pool.length > 0 && boardView === "overall" && (menChamp || womenChamp) && (
              <div className="champs-banner">
                {[["Men’s champion", menChamp], ["Women’s champion", womenChamp]].map(([lbl, c]) => (
                  <div className="champ-pill" key={lbl}>
                    <span className="cp-crown" aria-hidden>♛</span>
                    <div>
                      <div className="cp-label">{lbl}</div>
                      <div className="cp-name">
                        {c ? c.name : "—"}
                        {c && c.tied.length > 1 && <span className="cp-tie"> · tied</span>}
                      </div>
                    </div>
                    {c && <div className="cp-pts">{c.pts}</div>}
                  </div>
                ))}
                <div className="crown-actions">
                  <button className="ghost" onClick={crownChampions}>Record to Record Books</button>
                  {recorded && (
                    <span className="crown-hint">On record: {recorded.men || "—"} (M) · {recorded.women || "—"} (W)</span>
                  )}
                  {crownMsg && <span className="save-msg">{crownMsg}</span>}
                </div>
              </div>
            )}
            {pool.length > 0 && boardView !== "overall" && (() => {
              const c = boardView === "men" ? menChamp : womenChamp;
              if (!c) return null;
              return (
                <div className="champs-banner solo">
                  <div className="champ-pill">
                    <span className="cp-crown" aria-hidden>♛</span>
                    <div>
                      <div className="cp-label">{boardView === "men" ? "Men’s champion" : "Women’s champion"}</div>
                      <div className="cp-name">{c.name}{c.tied.length > 1 && <span className="cp-tie"> · tied</span>}</div>
                    </div>
                    <div className="cp-pts">{c.pts}</div>
                  </div>
                </div>
              );
            })()}

            {!loading && pool.length > 0 && (
              <Sheet rows={rankedFor(boardView)} view={boardView} results={results} capsApply={capsApply} />
            )}
          </section>
        )}

        {/* ============ RECORD BOOKS ============ */}
        {tab === "records" && (
          <section>
            <h2 className="sec-title">Record Books · all time</h2>
            <p className="muted">Every event crowns a men’s and a women’s champion. Titles are tallied across all years here.</p>

            <div className="records-wrap">
              <div className="titles">
                <div className="titles-h">Career titles</div>
                {titleBoard.map((p, i) => (
                  <div className={"title-row" + (p.total ? "" : " dim")} key={p.name}>
                    <span className={"tt-rank r" + (i + 1)}>{i + 1}</span>
                    <span className="tt-name">{p.name}</span>
                    <span className="tt-split">{p.men}<i>M</i> · {p.women}<i>W</i></span>
                    <span className="tt-total">{p.total}</span>
                  </div>
                ))}
              </div>

              <div className="ledger">
                <div className="titles-h">The honor roll</div>
                {!ledger.length && <div className="empty">No champions recorded yet.</div>}
                {ledger.map(({ year: yr, events }) => (
                  <div className="year-block" key={yr}>
                    <div className="year-h">{yr}</div>
                    <div className="champ-grid">
                      {events.map((e) => (
                        <div className="champ-card" key={e.meta.id} style={{ "--c": e.meta.accent }}>
                          <div className="cc-tour">{e.meta.name}</div>
                          <div className="cc-line"><span className="cc-side">M</span><span className="cc-name">{e.men || "—"}</span></div>
                          <div className="cc-line"><span className="cc-side">W</span><span className="cc-name">{e.women || "—"}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============ JOIN & NOTIFY (mailing list + draw-release email) ============ */}
        {tab === "invite" && <InviteTab tid={tid} tourName={tour.name} year={year} accent={accent} />}
      </main>

      <footer className="tp-foot">
        Picks and results are saved and shared with everyone using this pool.
      </footer>
    </div>
  );
}

function AutoFetchPanel({ tourName, year, fetching, error, msg, proposed, pickedAll, results, autoRefresh, onToggleAuto, onFetch, onApply, onDismiss, editing, onToggleEdit }) {
  return (
    <>
      <div className="autofetch">
        <button className="primary" onClick={onFetch} disabled={fetching}>
          {fetching ? "Fetching…" : "⟳ Auto-fetch results"}
        </button>
        <button className="ghost" onClick={onToggleEdit}>
          {editing ? "Done editing" : "✎ Edit scores"}
        </button>
        <label className="auto-toggle" title="On page load, automatically check the web for new results (at most once every few hours). You still confirm before anything counts.">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => onToggleAuto(e.target.checked)} />
          <span>Auto-check on load</span>
        </label>
        <span className="muted small">Pulls {tourName} {year} results via Claude web search — you confirm before anything counts.</span>
        {error && <span className="fetch-err">{error}</span>}
        {msg && <span className="save-msg">{msg}</span>}
      </div>
      {proposed && (
        <div className="fetch-review">
          <div className="fr-head">
            <span className="fr-title">Review before applying</span>
            <div className="fr-actions">
              <button className="primary" onClick={onApply}>Apply suggested</button>
              <button className="ghost" onClick={onDismiss}>Dismiss</button>
            </div>
          </div>
          <div className="fr-grid">
            {Object.keys(proposed).sort((a, b) => a.localeCompare(b)).map((p) => {
              const cur = results[p];
              const sug = proposed[p];
              const unknown = sug == null;
              const changed = !unknown && Number(sug) !== Number(cur ?? NaN);
              return (
                <div className={"fr-row" + (changed ? " changed" : "") + (unknown ? " unknown" : "")} key={p}>
                  <span className="fr-name">{p}</span>
                  <span className="fr-cur">{cur ?? "—"}</span>
                  <span className="fr-arrow">→</span>
                  <span className="fr-sug">{unknown ? "?" : sug}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small">Apply to write these into the scores, or dismiss to keep current values. “?” means it couldn’t determine that player.</p>
        </div>
      )}
    </>
  );
}

function Sheet({ rows, view, results, capsApply }) {
  const cell = (row, side, c) => {
    const player = row[side]?.[c.key] || "";
    const pts = player ? scoreFor(results[player], c.cap, capsApply) : null;
    return (
      <td className="sc-cell" key={side + c.key}>
        <span className={"sc-name" + (player ? "" : " empty")}>{player || "—"}</span>
        {player && <span className="sc-pts">{pts}</span>}
      </td>
    );
  };

  if (view !== "overall") {
    const totalField = view === "men" ? "men_pts" : "women_pts";
    return (
      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sc-player">Player</th>
              {CATEGORIES.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="sc-tot-h">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name}>
                <td className="sc-player"><span className="sc-rk">{i + 1}</span>{r.name}</td>
                {CATEGORIES.map((c) => cell(r, view, c))}
                <td className="sc-total">{r[totalField]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // overall — men block + women block + grand total, like the spreadsheet
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr>
            <th className="sc-player" rowSpan={2}>Player</th>
            <th className="grp grp-men" colSpan={CATEGORIES.length + 1}>Men</th>
            <th className="grp grp-women" colSpan={CATEGORIES.length + 1}>Women</th>
            <th className="sc-tot-h" rowSpan={2}>Total</th>
          </tr>
          <tr>
            {CATEGORIES.map((c) => <th key={"m" + c.key}>{c.label}</th>)}
            <th className="sc-sub-h">Pts</th>
            {CATEGORIES.map((c) => <th key={"w" + c.key}>{c.label}</th>)}
            <th className="sc-sub-h">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name}>
              <td className="sc-player"><span className="sc-rk">{i + 1}</span>{r.name}</td>
              {CATEGORIES.map((c) => cell(r, "men", c))}
              <td className="sc-sub">{r.men_pts}</td>
              {CATEGORIES.map((c) => cell(r, "women", c))}
              <td className="sc-sub">{r.women_pts}</td>
              <td className="sc-total">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JOIN & NOTIFY  (mailing list sign-up + draw-release email sender)  */
/* ------------------------------------------------------------------ */

const DEFAULT_RULE_NOTE = "Please note that the Rules Committee has made a rule change, where points scored by the runner-up and semi-finalists are capped by the final position chosen by the contestants. (Runner-ups can only score a max of 6 points, and semi-finalists can only score a max of 5 points.)";
const DEFAULT_BUYIN = "$10 for students and $20 for those who are not";

// Best-effort official draw-page links per tournament. URL patterns are pretty stable
// year to year, but sites occasionally restructure — double-check before sending,
// especially early in a season.
const DRAW_LINKS = {
  ao:  { men: "https://ausopen.com/draws",                                   women: "https://ausopen.com/draws" },
  iw:  { men: "https://bnpparibasopen.com/scores/draws",                     women: "https://bnpparibasopen.com/scores/draws?selected=womensSingles" },
  rg:  { men: "https://www.rolandgarros.com/en-us/draws",                    women: "https://www.rolandgarros.com/en-us/draws" },
  wim: { men: "https://www.wimbledon.com/en_GB/draws/gentlemens-singles",    women: "https://www.wimbledon.com/en_GB/draws/ladies-singles" },
  uso: { men: "https://www.usopen.org/en_US/draws/mens-singles.html",        women: "https://www.usopen.org/en_US/draws/womens-singles.html" },
};

function buildDrawEmailHtml({ tournament, deadline, mensUrl, womensUrl, siteUrl, buyin, ruleNote, sender }) {
  const mensLink = mensUrl ? `<a href="${mensUrl}">Men's</a>` : "Men's";
  const womensLink = womensUrl ? `<a href="${womensUrl}">Women's</a>` : "Women's";
  const siteLink = siteUrl ? `<a href="${siteUrl}">pool site</a>` : "pool site";

  let body = `Tennis aficionados:<br><br>`;
  body += `It's time for ${tournament || "[tournament]"}, which means it's time to make your bets<br><br>`;
  body += `Please enter your picks for the ${mensLink} and ${womensLink} brackets on the ${siteLink} by ${deadline || "[deadline]"}.<br><br>`;
  if (ruleNote) body += `${ruleNote}<br><br>`;
  body += `The buy-in remains the same, with ${buyin || "[buy-in]"}. Buy-in goes as a donation to <a href="https://visionaries-international.org/donate/">Visionaries International.</a><br><br>`;
  body += `You are welcome to share this with others (which means if you win you get more money 😉). `;
  body += `Note that "Top 10, 20, 30" refers to the seeding in the tournament, not the ATP or WTA ranking. `;
  body += `Please be sure to fill in only the player's last name correctly (if there are multiple players with the same last name, fill in the name with the first letter of the first name). Also please ignore the many N/As, those are there to make the updating of player scores faster.<br><br>`;
  body += `Good luck, have fun!<br>${sender || ""}`;
  return body;
}

function InviteTab({ tid, tourName, year, accent }) {
  // public join form
  const [subName, setSubName] = useState("");
  const [subEmail, setSubEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [subMsg, setSubMsg] = useState("");
  const [subBusy, setSubBusy] = useState(false);

  // admin composer
  const [password, setPassword] = useState("");
  const [tournament, setTournament] = useState(`${tourName} ${year}`);
  const [deadline, setDeadline] = useState("10:59 AM PST tomorrow");
  const [mensUrl, setMensUrl] = useState(DRAW_LINKS[tid]?.men || "");
  const [womensUrl, setWomensUrl] = useState(DRAW_LINKS[tid]?.women || "");
  const [siteUrl, setSiteUrl] = useState(typeof window !== "undefined" ? window.location.origin : "");
  const [buyin, setBuyin] = useState(DEFAULT_BUYIN);
  const [ruleNote, setRuleNote] = useState(DEFAULT_RULE_NOTE);
  const [sender, setSender] = useState("Ty");
  const [sendMsg, setSendMsg] = useState("");
  const [sending, setSending] = useState(false);

  const autofillLinks = () => {
    const links = DRAW_LINKS[tid];
    setTournament(`${tourName} ${year}`);
    if (links) { setMensUrl(links.men); setWomensUrl(links.women); }
    else setSendMsg("No known draw link for this event yet — paste it in manually.");
  };

  // subscriber management
  const [subscribers, setSubscribers] = useState(null); // null = not loaded yet
  const [listMsg, setListMsg] = useState("");

  const joinList = async (e) => {
    e.preventDefault();
    if (!subName.trim() || !subEmail.trim()) { setSubMsg("Name and email are both required."); return; }
    setSubBusy(true); setSubMsg("Joining…");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: subName.trim(), email: subEmail.trim(), company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't join.");
      setSubMsg("You're on the list!");
      setSubName(""); setSubEmail("");
    } catch (err) {
      setSubMsg(err.message);
    } finally {
      setSubBusy(false);
    }
  };

  const emailHtml = buildDrawEmailHtml({ tournament, deadline, mensUrl, womensUrl, siteUrl, buyin, ruleNote, sender });

  const sendEmail = async () => {
    if (!password) { setSendMsg("Enter the send password first."); return; }
    setSending(true); setSendMsg("Sending…");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, tournament, html: emailHtml }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setSendMsg(`Sent to ${data.count} subscriber(s).`);
    } catch (err) {
      setSendMsg(err.message);
    } finally {
      setSending(false);
    }
  };

  const loadSubscribers = async () => {
    if (!password) { setListMsg("Enter the send password first."); return; }
    setListMsg("Loading…");
    try {
      const res = await fetch("/api/subscribers", { headers: { "x-admin-password": password } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load list.");
      setSubscribers(data.subscribers);
      setListMsg(`${data.subscribers.length} on the list.`);
    } catch (err) {
      setListMsg(err.message);
    }
  };

  const removeSubscriber = async (email) => {
    try {
      const res = await fetch(`/api/subscribers?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });
      if (!res.ok) throw new Error("Remove failed.");
      loadSubscribers();
    } catch (err) {
      setListMsg(err.message);
    }
  };

  return (
    <section>
      <h2 className="sec-title">Join &amp; Notify</h2>
      <p className="muted">Anyone can join the mailing list below. The organizer's panel on the right sends the draw-release email to everyone on it.</p>

      <div className="invite-grid">
        {/* ---------- public join form ---------- */}
        <div className="board">
          <div className="board-head"><span className="dot" />Join the list</div>
          <form onSubmit={joinList}>
            <div className="pick-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <input className="name-input" placeholder="Your name" value={subName} onChange={(e) => setSubName(e.target.value)} />
              <input className="name-input" type="email" placeholder="you@email.com" value={subEmail} onChange={(e) => setSubEmail(e.target.value)} />
              <input
                type="text" value={company} onChange={(e) => setCompany(e.target.value)}
                tabIndex={-1} autoComplete="off" aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
              />
              <button type="submit" className="primary" disabled={subBusy} style={{ alignSelf: "flex-start" }}>
                {subBusy ? "Joining…" : "Join the list"}
              </button>
              {subMsg && <span className="save-msg">{subMsg}</span>}
            </div>
          </form>
        </div>

        {/* ---------- organizer admin panel ---------- */}
        <div className="board">
          <div className="board-head"><span className="dot" />Send the draw email</div>

          <div className="pick-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <input className="name-input" type="password" placeholder="Send password" value={password} onChange={(e) => setPassword(e.target.value)} />

            <input className="name-input" placeholder="Tournament" value={tournament} onChange={(e) => setTournament(e.target.value)} />
            <input className="name-input" placeholder="Deadline (e.g. 10:59 AM PST tomorrow)" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted small">Draw links</span>
              <button type="button" className="ghost" onClick={autofillLinks} style={{ padding: "4px 10px", fontSize: 12 }}>
                ↺ Use official {tourName} pages
              </button>
            </div>
            <input className="name-input" placeholder="Men's draw link" value={mensUrl} onChange={(e) => setMensUrl(e.target.value)} />
            <input className="name-input" placeholder="Women's draw link" value={womensUrl} onChange={(e) => setWomensUrl(e.target.value)} />
            <input className="name-input" placeholder="Pool site link" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
            <input className="name-input" placeholder="Buy-in line" value={buyin} onChange={(e) => setBuyin(e.target.value)} />
            <textarea
              className="name-input" rows={3} placeholder="Rule note (leave blank to omit)"
              value={ruleNote} onChange={(e) => setRuleNote(e.target.value)}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
            <input className="name-input" placeholder="Sign-off name" value={sender} onChange={(e) => setSender(e.target.value)} />

            <div className="save-bar">
              <button className="primary" onClick={sendEmail} disabled={sending}>
                {sending ? "Sending…" : "Send to mailing list"}
              </button>
              {sendMsg && <span className="save-msg">{sendMsg}</span>}
            </div>

            <div className="save-bar">
              <button className="ghost" type="button" onClick={loadSubscribers}>Show sign-up list</button>
              {listMsg && <span className="save-msg">{listMsg}</span>}
            </div>

            {subscribers && (
              <div style={{ marginTop: 6 }}>
                {!subscribers.length && <div className="empty">No sign-ups yet.</div>}
                {subscribers.map((s) => (
                  <div key={s.email} className="pick-row">
                    <span style={{ flex: 1 }}>{s.name} — {s.email}</span>
                    <button type="button" className="ghost" onClick={() => removeSubscriber(s.email)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- live preview ---------- */}
      <div className="board" style={{ marginTop: 16 }}>
        <div className="board-head"><span className="dot" />Preview</div>
        <div className="email-preview" style={{ borderColor: accent }} dangerouslySetInnerHTML={{ __html: emailHtml }} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  STYLES                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

.tp-root{
  --ink:#0e1714; --panel:#12211c; --panel2:#16271f; --line:#22382e;
  --text:#e8efe9; --muted:#8aa399; --soft:#b9ccc3;
  font-family:'Inter',system-ui,sans-serif; color:var(--text);
  background:
    radial-gradient(1200px 500px at 50% -150px, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
    var(--ink);
  min-height:100%; padding-bottom:48px;
}
.tp-root *{box-sizing:border-box}

/* header */
.tp-head{position:relative; overflow:hidden; padding:46px 24px 30px; border-bottom:1px solid var(--line)}
.court-lines{position:absolute; inset:0; opacity:.18; pointer-events:none;
  background-image:
    linear-gradient(var(--glow) 1px, transparent 1px),
    linear-gradient(90deg, var(--glow) 1px, transparent 1px);
  background-size:100% 64px, 64px 100%;
  -webkit-mask-image:radial-gradient(120% 120% at 50% 0%, #000 30%, transparent 75%);
          mask-image:radial-gradient(120% 120% at 50% 0%, #000 30%, transparent 75%);
}
.head-inner{position:relative; max-width:960px; margin:0 auto; text-align:center}
.eyebrow{font-size:12px; letter-spacing:.32em; text-transform:uppercase; color:var(--glow); font-weight:600}
.title{font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.01em;
  font-size:clamp(40px,8vw,76px); line-height:.92; margin:8px 0 10px; text-transform:uppercase}
.meta{display:flex; gap:10px; justify-content:center; align-items:center; color:var(--soft); font-size:14px; flex-wrap:wrap}
.meta i{color:var(--accent); font-style:normal}

/* event bar */
.event-bar{max-width:960px; margin:20px auto 0; padding:0 16px; display:flex; gap:14px;
  justify-content:space-between; align-items:center; flex-wrap:wrap}
.chips{display:flex; gap:8px; flex-wrap:wrap}
.chip{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.04em;
  font-size:14px; font-weight:600; padding:7px 13px; border-radius:999px; cursor:pointer;
  background:transparent; border:1.5px solid; transition:.15s; color:var(--accent)}
.chip.active{color:#fff !important}
.chip:hover{transform:translateY(-1px)}
.year-sel{display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:4px}
.yr{font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:600; color:var(--muted);
  background:transparent; border:0; padding:5px 11px; border-radius:7px; cursor:pointer}
.yr.active{background:var(--accent); color:#fff}

/* tabs */
.tabs{max-width:960px; margin:22px auto 0; padding:0 16px; display:flex; gap:4px; border-bottom:1px solid var(--line)}
.tab{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.06em;
  font-size:15px; font-weight:600; color:var(--muted); background:transparent; border:0; padding:11px 14px;
  cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px}
.tab:hover{color:var(--soft)}
.tab.active{color:var(--text); border-bottom-color:var(--accent)}

.tp-main{max-width:960px; margin:0 auto; padding:26px 16px 0}
.sec-title{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.05em;
  font-size:24px; font-weight:600; margin:0 0 6px}
.muted{color:var(--muted)} .small{font-size:13px}

/* picks */
.namebar{display:flex; gap:10px; align-items:center; margin-bottom:18px; flex-wrap:wrap}
.name-input{flex:1; min-width:220px; background:var(--panel); border:1px solid var(--line); color:var(--text);
  padding:11px 14px; border-radius:10px; font-size:15px; outline:none}
.name-input:focus{border-color:var(--accent)}
.ghost{background:transparent; border:1px solid var(--line); color:var(--soft); padding:10px 14px;
  border-radius:10px; cursor:pointer; font-size:14px}
.ghost:hover{border-color:var(--accent); color:var(--text)}
.counter{font-family:'Barlow Condensed',sans-serif; font-size:15px; color:var(--muted); margin-left:auto}

.boards{display:grid; grid-template-columns:1fr 1fr; gap:16px}
@media(max-width:720px){.boards{grid-template-columns:1fr}}
.board{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 14px 8px}
.board-head{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.06em;
  font-size:18px; font-weight:600; display:flex; align-items:center; gap:9px; margin-bottom:10px}
.dot{width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--glow)}
.pick-row{display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px solid var(--line)}
.pick-row:first-of-type{border-top:0}
.pick-label{display:flex; flex-direction:column; min-width:128px}
.pl-main{font-size:14px; font-weight:600}
.pl-hint{font-size:11px; color:var(--muted)}

/* combobox */
.combo{position:relative; flex:1}
.combo-trigger{width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px;
  background:var(--panel2); border:1px solid var(--line); color:var(--text); padding:9px 12px;
  border-radius:9px; cursor:pointer; font-size:14px; text-align:left}
.combo-trigger.filled{font-weight:600}
.combo-ph{color:var(--muted)}
.combo-caret{color:var(--muted); font-size:11px}
.combo-clear{color:var(--muted); font-size:12px; padding:0 2px}
.combo-clear:hover{color:#fff}
.combo-pop{position:absolute; z-index:30; top:calc(100% + 5px); left:0; right:0; background:#0f1d18;
  border:1px solid var(--accent); border-radius:11px; padding:8px; box-shadow:0 16px 40px rgba(0,0,0,.45)}
.combo-input{width:100%; background:var(--panel); border:1px solid var(--line); color:var(--text);
  padding:8px 10px; border-radius:8px; outline:none; font-size:14px; margin-bottom:6px}
.combo-input:focus{border-color:var(--accent)}
.combo-list{max-height:210px; overflow:auto}
.combo-opt{padding:8px 10px; border-radius:7px; cursor:pointer; font-size:14px;
  display:flex; align-items:center; justify-content:space-between; gap:8px}
.combo-opt:hover{background:var(--panel2)}
.combo-opt.blocked{cursor:not-allowed; color:var(--muted); opacity:.6}
.combo-opt.blocked:hover{background:transparent}
.combo-add{color:var(--glow); font-weight:600}
.combo-empty{padding:8px 10px; color:var(--muted); font-size:13px}
.seed-badge{font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:11px; color:var(--accent);
  background:color-mix(in srgb, var(--accent) 16%, transparent); border-radius:5px; padding:1px 5px; margin-left:6px}
.seed-badge.block{color:#ff9d8a; background:color-mix(in srgb, #ff9d8a 16%, transparent)}
.combo-trigger.bad{border-color:#ff9d8a !important}
.combo-trigger.bad .seed-badge{color:#ff9d8a; background:color-mix(in srgb, #ff9d8a 16%, transparent)}

.save-bar{display:flex; align-items:center; gap:14px; margin-top:18px}
.primary{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.06em;
  font-weight:700; font-size:16px; color:#fff; background:var(--accent); border:0; padding:12px 24px;
  border-radius:11px; cursor:pointer; box-shadow:0 8px 24px color-mix(in srgb, var(--accent) 45%, transparent)}
.primary:hover{filter:brightness(1.08)}
.save-msg{color:var(--glow); font-size:14px}
.scoring-note{margin-top:18px; color:var(--muted); font-size:13px; line-height:1.6; max-width:680px}

/* pool */
.cards{display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px}
@media(max-width:720px){.cards{grid-template-columns:1fr}}
.entry{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px}
.entry-name{font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:600; margin-bottom:10px;
  padding-bottom:8px; border-bottom:2px solid var(--accent); display:inline-block}
.entry-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px}
.entry-side{font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin-bottom:5px}
.entry-pick{display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:3px 0}
.ep-cat{color:var(--muted)} .ep-name{font-weight:600; text-align:right}

/* results */
.results-cols{display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:14px}
@media(max-width:720px){.results-cols{grid-template-columns:1fr}}
.res-col{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px}
.res-head{font-family:'Barlow Condensed',sans-serif; font-size:18px; text-transform:uppercase;
  letter-spacing:.06em; font-weight:600; margin-bottom:8px}
.res-row{display:flex; align-items:center; gap:10px; padding:6px 0; border-top:1px solid var(--line)}
.res-row:first-of-type{border-top:0}
.res-name{flex:1; font-size:14px}
.wins-input{width:62px; background:var(--panel2); border:1px solid var(--line); color:var(--text);
  padding:7px 9px; border-radius:8px; font-size:14px; text-align:center; outline:none}
.wins-input:focus{border-color:var(--accent)}
.res-unit{color:var(--muted); font-size:12px; width:34px}

/* auto-fetch results */
.autofetch{display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin:16px 0 4px}
.auto-toggle{display:inline-flex; align-items:center; gap:7px; cursor:pointer; user-select:none;
  font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.04em;
  font-size:13px; font-weight:600; color:var(--soft)}
.auto-toggle input{width:15px; height:15px; accent-color:var(--accent); cursor:pointer}
.draw-bar{display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin:0 0 18px;
  padding:10px 14px; background:var(--panel); border:1px solid var(--line); border-radius:12px}
.fetch-err{color:#ff9d8a; font-size:14px}
.fetch-review{margin:14px 0 4px; background:var(--panel); border:1px solid var(--accent);
  border-radius:14px; padding:14px 16px}
.fr-head{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px}
.fr-title{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.06em;
  font-weight:600; color:var(--soft)}
.fr-actions{display:flex; gap:8px}
.fr-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:6px 14px}
.fr-row{display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; font-size:14px}
.fr-row.changed{background:color-mix(in srgb, var(--accent) 12%, transparent)}
.fr-row.unknown{opacity:.5}
.fr-name{flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.fr-cur{font-family:'Barlow Condensed',sans-serif; font-weight:700; color:var(--muted); min-width:18px; text-align:center}
.fr-arrow{color:var(--muted)}
.fr-sug{font-family:'Barlow Condensed',sans-serif; font-weight:700; color:var(--glow); min-width:18px; text-align:center}
.fr-row.changed .fr-sug{color:var(--accent)}

/* standings */
.board-table{margin-top:14px; display:flex; flex-direction:column; gap:7px}
.st-row{background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden}
.st-row.open{border-color:var(--accent)}
.st-main{width:100%; display:flex; align-items:center; gap:14px; padding:12px 14px; background:transparent;
  border:0; color:var(--text); cursor:pointer; text-align:left}
.rank{font-family:'Barlow Condensed',sans-serif; font-size:18px; font-weight:700; width:30px; height:30px;
  display:grid; place-items:center; border-radius:8px; background:var(--panel2); color:var(--muted); flex:none}
.rank.r1{background:var(--accent); color:#fff}
.rank.r2,.rank.r3{color:var(--soft)}
.st-name{flex:1; font-size:16px; font-weight:600}
.st-split{font-family:'Barlow Condensed',sans-serif; color:var(--muted); font-size:15px}
.st-split i{font-style:normal; font-size:11px; opacity:.7}
.st-total{font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:700; color:var(--glow); min-width:42px; text-align:right}
.st-exp{color:var(--muted); width:14px}
.st-detail{display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:0 14px 14px; border-top:1px solid var(--line); padding-top:12px}
@media(max-width:560px){.st-detail{grid-template-columns:1fr}}
.st-side-h{font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--accent); margin-bottom:6px}
.st-pick{display:grid; grid-template-columns:90px 1fr 28px; gap:8px; font-size:13px; padding:3px 0}
.stp-cat{color:var(--muted)} .stp-name{font-weight:500}
.stp-pts{text-align:right; font-family:'Barlow Condensed',sans-serif; font-weight:700; color:var(--glow)}

.empty{background:var(--panel); border:1px dashed var(--line); border-radius:12px; padding:22px;
  text-align:center; color:var(--muted); margin-top:14px}
.tp-foot{max-width:960px; margin:34px auto 0; padding:14px 16px 0; border-top:1px solid var(--line);
  color:var(--muted); font-size:12px; text-align:center}

/* champion banner (standings) */
.champs-banner{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0 18px}
@media(max-width:560px){.champs-banner{grid-template-columns:1fr}}
.champ-pill{display:flex; align-items:center; gap:12px; background:var(--panel);
  border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:12px; padding:12px 14px}
.cp-crown{font-size:20px; color:var(--accent); line-height:1}
.cp-label{font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted)}
.cp-name{font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:600}
.cp-tie{font-size:12px; color:var(--muted); font-family:'Inter',sans-serif; font-weight:400}
.cp-pts{margin-left:auto; font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:700; color:var(--glow)}
.crown-actions{grid-column:1/-1; display:flex; align-items:center; gap:14px; flex-wrap:wrap}
.crown-hint{color:var(--muted); font-size:13px}

/* men / women / overall segmented control */
.seg{display:inline-flex; gap:4px; background:var(--panel); border:1px solid var(--line);
  border-radius:11px; padding:4px; margin-bottom:18px}
.seg-btn{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.05em;
  font-size:15px; font-weight:600; color:var(--muted); background:transparent; border:0;
  padding:8px 20px; border-radius:8px; cursor:pointer; transition:.15s}
.seg-btn:hover:not(.active){color:var(--soft)}
.seg-btn.active{background:var(--accent); color:#fff}
.champs-banner.solo{grid-template-columns:1fr; max-width:440px}
.st-detail.one{grid-template-columns:1fr}

/* spreadsheet-style standings table */
.sheet-wrap{margin-top:6px; overflow-x:auto; border:1px solid var(--line); border-radius:14px;
  background:var(--panel); -webkit-overflow-scrolling:touch}
.sheet{border-collapse:separate; border-spacing:0; width:100%; font-size:13px; white-space:nowrap}
.sheet th, .sheet td{padding:9px 12px; text-align:left; border-bottom:1px solid var(--line)}
.sheet tbody tr:last-child td{border-bottom:0}
.sheet thead th{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.03em;
  font-size:11px; font-weight:600; color:var(--muted); background:var(--panel2)}
.sheet thead th.grp{text-align:center; font-size:13px; letter-spacing:.08em; border-bottom:1px solid var(--line)}
.grp-men{color:var(--soft)}
.grp-women{color:var(--soft)}
.sheet tbody tr:hover td{background:var(--panel2)}
.sc-player{position:sticky; left:0; z-index:1; background:var(--panel); font-weight:600;
  border-right:1px solid var(--line); min-width:130px}
.sheet thead .sc-player{z-index:3; background:var(--panel2)}
.sheet tbody tr:hover .sc-player{background:var(--panel2)}
.sc-rk{display:inline-grid; place-items:center; width:20px; height:20px; margin-right:9px; border-radius:6px;
  background:var(--panel2); color:var(--muted); font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:12px; vertical-align:middle}
.sheet tbody tr:first-child .sc-rk{background:var(--accent); color:#fff}
.sc-name{color:var(--text)}
.sc-name.empty{color:var(--muted)}
.sc-pts{display:inline-block; margin-left:7px; min-width:15px; text-align:center; font-family:'Barlow Condensed',sans-serif;
  font-weight:700; font-size:12px; color:var(--glow);
  background:color-mix(in srgb, var(--accent) 16%, transparent); border-radius:5px; padding:0 5px}
.sc-sub, .sc-sub-h{text-align:right; border-left:1px solid var(--line)}
.sc-sub{font-family:'Barlow Condensed',sans-serif; font-weight:700; color:var(--soft); background:var(--panel2)}
.sheet tbody tr:hover .sc-sub{background:var(--line)}
.sc-tot-h{text-align:right; border-left:1px solid var(--line)}
.sc-total{text-align:right; border-left:1px solid var(--line);
  font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:20px; color:var(--glow)}

/* record books */
.records-wrap{display:grid; grid-template-columns:340px 1fr; gap:18px; margin-top:16px; align-items:start}
@media(max-width:760px){.records-wrap{grid-template-columns:1fr}}
.titles-h{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.08em;
  font-size:15px; font-weight:600; color:var(--soft); margin-bottom:10px}
.titles{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px}
.title-row{display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px solid var(--line)}
.title-row:first-of-type{border-top:0}
.title-row.dim{opacity:.45}
.tt-rank{font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:700; width:24px; height:24px;
  display:grid; place-items:center; border-radius:7px; background:var(--panel2); color:var(--muted); flex:none}
.tt-rank.r1{background:var(--accent); color:#fff}
.tt-name{flex:1; font-size:15px; font-weight:600}
.tt-split{font-family:'Barlow Condensed',sans-serif; color:var(--muted); font-size:14px}
.tt-split i{font-style:normal; font-size:10px; opacity:.7}
.tt-total{font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:700; color:var(--glow); min-width:30px; text-align:right}

.year-block{margin-bottom:18px}
.year-h{font-family:'Barlow Condensed',sans-serif; font-size:30px; font-weight:700; line-height:1;
  color:var(--text); border-bottom:1px solid var(--line); padding-bottom:6px; margin-bottom:12px}
.champ-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px}
.champ-card{background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--c);
  border-radius:12px; padding:12px}
.cc-tour{font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:.05em;
  font-size:14px; font-weight:600; color:var(--c); margin-bottom:8px}
.cc-line{display:flex; align-items:center; gap:8px; padding:2px 0; font-size:14px}
.cc-side{font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:12px; color:var(--muted);
  width:16px; height:16px; display:grid; place-items:center; border:1px solid var(--line); border-radius:4px; flex:none}
.cc-name{font-weight:600}

/* join & notify */
.invite-grid{display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px}
@media(max-width:720px){.invite-grid{grid-template-columns:1fr}}
.email-preview{background:var(--panel2); border:1px solid var(--line); border-left:3px solid var(--accent);
  border-radius:10px; padding:16px 18px; font-size:14px; line-height:1.6; color:var(--text)}
.email-preview a{color:var(--glow)}
`;
