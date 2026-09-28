// Invented content for the mock Xtream server: every title, channel, person
// and plot here is made up for screenshots. Nothing refers to a real film,
// show, broadcaster or brand. Output is seeded, so every run serves the same
// catalogue and screenshots can be retaken identically.

// --- Seeded randomness ---------------------------------------------------------

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small deterministic PRNG (mulberry32) seeded from a string. */
export function rng(seed) {
  let a = hash(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    sample: (list, n) => [...list].sort(() => next() - 0.5).slice(0, n),
  };
}

// --- People --------------------------------------------------------------------

const FIRST = ["Maya", "Elias", "Noor", "Theo", "Ines", "Rafael", "Hana", "Jonah", "Priya", "Luca", "Amara", "Felix", "Sofia", "Kai", "Leila", "Owen", "Mei", "Daniel", "Zara", "Tomas", "Aisha", "Callum", "Yara", "Mateo", "Freya", "Idris", "Clara", "Ravi", "Nadia", "Oscar"];
const LAST = ["Hart", "Okafor", "Lindqvist", "Moreau", "Castellano", "Brennan", "Sato", "Ellery", "Varga", "Achterberg", "Quinn", "Delacroix", "Nakamura", "Oyelaran", "Whitlock", "Santoro", "Kowalczyk", "Ashdown", "Ferreira", "Halloran", "Iverson", "Marchetti", "Rahman", "Thorne", "Vance", "Abernathy", "Kessler", "Lowell", "Petrov", "Sinclair"];

function person(r) {
  return `${r.pick(FIRST)} ${r.pick(LAST)}`;
}

// --- Movies --------------------------------------------------------------------

/** Movie categories and their titles. "Animation Movies" is one of the Kids rules' bundled category names, so a Kids profile has something to show. */
export const MOVIE_GENRES = [
  {
    name: "New Releases",
    genre: "Drama, Thriller",
    titles: ["The Quiet Hour", "Glass Harbor", "Northbound", "Paper Lanterns", "The Long Weekend", "Salt & Stone", "After the Rain", "Borrowed Time", "Midnight Ferry", "The Last Good Summer", "Cold Open", "Wildflower Road"],
  },
  {
    name: "Action & Adventure",
    genre: "Action, Adventure",
    titles: ["Iron Meridian", "Redline Protocol", "Coastline Run", "The Vault at Kestrel Bay", "Hard Frontier", "Blackwater Run", "Zero Hour Heist", "Falcon Canyon", "Parcel Run", "Steel Horizon", "Firebreak", "Last Stand at Dunmore", "Rogue Signal", "Crossfire Express"],
  },
  {
    name: "Comedy",
    genre: "Comedy",
    titles: ["My Neighbor's Wedding", "Totally Fine", "The Worst Best Man", "Road Trip to Nowhere", "Kitchen Nightshift", "Office Hours", "Party of One", "The Inheritance Game", "Weekend at Grandma's", "Accidental Tourists", "Second Date", "Supply Teacher"],
  },
  {
    name: "Drama",
    genre: "Drama",
    titles: ["The Lighthouse Keeper's Daughter", "Letters from Alder Street", "Undertow", "A Year in Portland", "The Weight of Snow", "Small Mercies", "The Piano Room", "Harvest Hymn", "What We Carry", "River of Names", "The Understudy", "Stillhouse Pond"],
  },
  {
    name: "Thriller & Mystery",
    genre: "Thriller, Mystery",
    titles: ["The Ninth Guest", "Dead Reckoning", "Dead Angle", "The Harrow Affair", "The 3 A.M. Shift", "Missing in Marlow", "The Silent Witness Room", "Echo Point", "Fault Lines", "The Stranger Upstairs", "Cold Case 1987", "Room 414"],
  },
  {
    name: "Sci-Fi & Fantasy",
    genre: "Science Fiction, Fantasy",
    titles: ["Orbit Nine", "The Last Colony", "Starlight Drift", "Paradox Engine", "Emberfall", "The Clockmaker's Gate", "Signal from Kepler", "Halcyon Station", "The Dreaming Forest", "Tidebreaker", "Chronos Divide", "Nova Frontier"],
  },
  {
    name: "Romance",
    genre: "Romance, Comedy",
    titles: ["Love, Unscripted", "The Bookshop on Ivy Lane", "Summer in Lisbon", "Two Tickets to Paris", "Meet Me at the Gallery", "The Wedding Planner's Rules", "Autumn Letters", "Coffee for Two", "Starlight Serenade", "Right Place, Wrong Time"],
  },
  {
    name: "Animation Movies",
    genre: "Animation, Family, Adventure",
    titles: ["Pip and the Moon Balloon", "The Brave Little Tugboat", "Dino Dentist", "Kip's Big Snow Day", "The Lost Kite Kingdom", "Robo Pals", "Owl Academy", "Penguin Parade", "The Cloud Painter", "Captain Whiskers", "Pocket Heroes", "The Magic Crayon"],
  },
  {
    name: "Documentaries",
    genre: "Documentary",
    titles: ["Wild Coasts", "The Last Glaciers", "Deep Blue Cities", "Coffee: A Global Story", "Night Skies", "The Beekeepers", "Built to Last", "Rivers of the World", "The Secret Forest Year", "Street Food Journeys", "Voices of the Desert", "Engines of Change"],
  },
  {
    name: "Horror",
    genre: "Horror",
    titles: ["The Hollow House", "Whisperwood", "Don't Answer", "The Seventh Floor", "Lanterns in the Fog", "Nightwatch Motel", "The Late Visitor", "Below Deck", "Static Hour", "The Harvest Festival"],
  },
];

const MOVIE_PLOTS = {
  "New Releases": [
    "{a} returns to a small coastal town after ten years away and finds that the family secret everyone buried is about to surface.",
    "Two strangers stranded by a cancelled train spend one long night crossing the city together — and neither is who they claim to be.",
  ],
  "Action & Adventure": [
    "Ex-agent {a} is pulled back for one last job: recover a stolen drive before it reaches the highest bidder in 48 hours.",
    "When a routine convoy is ambushed in the mountains, rookie pilot {a} has to lead the survivors home through hostile ground.",
  ],
  Comedy: [
    "{a} agrees to fake-date an old friend for a family wedding weekend. What could possibly go wrong? Everything.",
    "A chaotic family road trip goes spectacularly off-course when {a} insists on taking the scenic route.",
  ],
  Drama: [
    "After her mother's death, {a} moves into the old family house and uncovers letters that change everything she knew.",
    "A gifted but troubled pianist and the teacher who refuses to give up on him spend one winter preparing for the audition of a lifetime.",
  ],
  "Thriller & Mystery": [
    "Detective {a} investigates a disappearance at a remote hotel where every guest has something to hide.",
    "A night-shift security guard notices the same stranger on the cameras every night at 3:14 a.m. — and then the stranger looks back.",
  ],
  "Sci-Fi & Fantasy": [
    "The crew of a deep-space station receives a message from a ship that vanished forty years ago.",
    "{a} discovers a door in an old clock shop that opens onto a different city every hour.",
  ],
  Romance: [
    "A bookshop owner and a travelling architect keep meeting by accident — until it stops being an accident.",
    "{a} has one summer in Lisbon to finish a novel. Falling in love wasn't part of the plan.",
  ],
  "Animation Movies": [
    "A curious little inventor builds a balloon to visit the Moon and makes friends with everyone she meets along the way.",
    "A brave little tugboat sets out across the big harbour to find her way home before the storm.",
  ],
  Documentaries: [
    "A breathtaking journey across five continents following the people and wildlife who depend on them.",
    "Filmed over three years, this documentary follows the scientists racing to understand a changing planet.",
  ],
  Horror: [
    "A family moves into a farmhouse at the edge of the woods and starts hearing voices in the walls.",
    "Five friends spend the night in an abandoned motel. Only four check out.",
  ],
};

// --- Series --------------------------------------------------------------------

/** "Kids Series" is one of the Kids rules' bundled category names. */
export const SERIES_GENRES = [
  { name: "Trending Now", genre: "Drama, Mystery", titles: ["Harbor Lights", "The Kingsley Files", "Northern Line", "Blue Hour", "The Firm on Carver Street", "Deep Water Point", "Crown & Anchor", "Last Orders at the Rook"] },
  { name: "Crime & Mystery", genre: "Crime, Mystery", titles: ["Precinct 12", "The Marlow Murders", "Cold Trail", "Chain of Evidence", "The Night Desk", "Undercover Blue", "Shadow Docket", "Double Blind"] },
  { name: "Drama Series", genre: "Drama", titles: ["The Ashford Family", "Saint Clair Hospital", "Riverside", "Homeward", "Everything We Were", "The Vineyard", "Second Chances", "Main Street"] },
  { name: "Comedy Series", genre: "Comedy", titles: ["Flat 4B", "The Night Kitchen", "Mixed Doubles", "Office Politics", "Grandpa Moves In", "Startup Life", "Next Door Down", "Weekend Warriors"] },
  { name: "Sci-Fi Series", genre: "Science Fiction", titles: ["Outer Rim", "Parallel", "Signal Lost", "Colony Seven", "Tomorrow's Children", "Deep Orbit", "The Archivists", "After the Fall"] },
  { name: "Kids Series", genre: "Animation, Kids", titles: ["Robo Pals", "Owl Academy Adventures", "Captain Whiskers Sets Sail", "The Busy Builders", "Dino Detectives", "Little Explorers", "Bubble Bay", "Rainbow Club"] },
  { name: "Docuseries", genre: "Documentary", titles: ["Ocean Worlds", "Great Kitchens of the World", "The Makers", "Wild Islands", "Mountains", "Inside the Workshop", "Night Cities", "Hidden Trails"] },
  { name: "Reality & Lifestyle", genre: "Reality, Lifestyle", titles: ["Home Rescue", "Bake Along", "Garden Makeover", "Road to the Runway", "Tiny House Dreams", "Weekend Chef", "Treasure Hunters", "Island Escape"] },
];

/** Plots per series category, in SERIES_GENRES order. */
const SERIES_PLOTS = [
  ["In a close-knit harbour town, {a} returns home to take over the family business and gets caught up in a mystery that divides the community.", "A young lawyer, {a}, takes on the case nobody else will — and the city's most powerful family takes notice."],
  ["Each season follows a new case for detective {a} and a small team willing to bend the rules to get to the truth.", "When a body turns up in a quiet village, {a} has one week to find the killer before the trail goes cold."],
  ["Three generations of the same family share one house, one business and far too many secrets.", "The doctors and nurses of a busy city hospital juggle life-and-death decisions with lives of their own."],
  ["An ensemble of friends, flatmates and neighbours navigate love, ambition and the occasional disaster.", "{a} moves back in with the family at thirty-five. Everyone has opinions."],
  ["The crew of a distant colony discovers they aren't the first people to arrive.", "A signal from deep space changes everything {a} thought they knew about the universe."],
  ["Big adventures for small heroes — every episode is a new friendship, a new problem and a new way to solve it together.", "A team of curious little explorers sets out to discover how the world works, one question at a time."],
  ["Stunning, intimate storytelling from the places and people that shape our world.", "Travelling to kitchens, workshops and wild places to meet the people who keep traditions alive."],
  ["Everyday people, big transformations — and a few surprises along the way.", "Talented amateurs compete over eight weeks for the title — and bragging rights."],
];

const EPISODE_WORDS = ["Homecoming", "The Storm", "Crossroads", "Old Friends", "The Offer", "Night Moves", "Fault Lines", "The Letter", "Open House", "Loose Ends", "The Late Visitor", "High Tide", "Dead Angle", "Second Chances", "The Deal", "Last Light", "New Beginnings", "The Test", "Lost & Found", "The Big Day", "Fresh Start", "Runaway", "The Long Road", "Full Circle"];

// --- Live TV -------------------------------------------------------------------

/** Invented channel names — deliberately not any real broadcaster. */
export const LIVE_GENRES = [
  { name: "News", archive: true, channels: ["Northwind News 24", "Global Wire", "City Desk Live", "Market Pulse", "Weather Now", "World Report", "Parliament Live", "Evening Edition"] },
  { name: "Sports", archive: true, channels: ["Stadium Sports 1", "Stadium Sports 2", "Pitchside", "Fairway Golf", "Paddock TV", "Court Side Tennis", "Ringside Live", "Extreme Outdoors", "Sports Replay HD"] },
  { name: "Entertainment", archive: true, channels: ["Aurora One", "Lantern Stories", "Storyline TV", "Brightside TV", "Chuckle TV", "Laugh Track", "Hits Drama", "Replay Drama"] },
  { name: "Movies", archive: false, channels: ["Silver Screen 1", "Silver Screen Action", "Silver Screen Classics", "Big Screen Box", "Indie Screen", "Family Movies", "Thriller Zone", "Romance Channel"] },
  { name: "Kids", archive: false, channels: ["Kids Club", "Doodle TV", "Little Learners", "Junior Adventures", "Cartoon Corner", "Tiny Tales"] },
  { name: "Documentary", archive: true, channels: ["Explorer Earth", "Timeline TV", "Wild Frontier", "Science Now", "Travel & Tales", "Engineering Wonders"] },
  { name: "Music", archive: false, channels: ["Hit Radio TV", "Classic Rock Live", "Chill Lounge", "Country Roads", "Jazz Club", "Pop Charts 40"] },
  { name: "Lifestyle", archive: false, channels: ["Homestead TV", "Kitchen Table TV", "Wardrobe TV", "Fit Life", "Auto World"] },
];

const PROGRAMMES = {
  News: ["Morning Briefing", "World Report", "Business Today", "Headlines Now", "Weather Watch", "Newsroom Live", "The Evening Edition", "Late Night News", "Global Markets", "In Conversation"],
  Sports: ["Matchday Live", "Top Flight Football", "Sports Desk", "Golf Highlights", "Tennis Open: Quarter-Final", "Racing Weekend", "Ringside Countdown", "Extreme Sports Weekly", "The Big Match Replay", "Sports Tonight"],
  Entertainment: ["Late Night Live", "Celebrity Kitchen", "Talent Search", "Harbor Lights", "Flat 4B", "Saint Clair Hospital", "Comedy Hour", "Quiz Night", "Weekend Live", "Behind the Scenes"],
  Movies: ["Iron Meridian", "The Quiet Hour", "Orbit Nine", "My Neighbor's Wedding", "Glass Harbor", "The Ninth Guest", "Starlight Drift", "Summer in Lisbon", "Coastline Run", "Undertow"],
  Kids: ["Robo Pals", "Dino Detectives", "Little Explorers", "Bubble Bay", "The Busy Builders", "Owl Academy Adventures", "Story Time", "Captain Whiskers Sets Sail", "Rainbow Club", "Draw With Me"],
  Documentary: ["Wild Coasts", "Engines of Change", "The Last Glaciers", "Deep Blue Cities", "Ancient Empires", "Factory Floor", "Ocean Worlds", "Night Skies", "The Beekeepers", "Mountains"],
  Music: ["Top 40 Countdown", "Rock Classics", "Live Sessions", "Chill Mix", "Country Hour", "Jazz at Midnight", "Video Hits", "Acoustic Evenings", "Artist Spotlight", "Dance Floor"],
  Lifestyle: ["Home Rescue", "Bake Along", "Garden Makeover", "Weekend Chef", "Style Files", "Fit in 30", "Tiny House Dreams", "Road Test", "Island Escape", "Treasure Hunters"],
};

const PROGRAMME_DESCRIPTIONS = {
  News: "The latest headlines, analysis and interviews from around the world.",
  Sports: "Live coverage, highlights and expert analysis.",
  Entertainment: "Your favourite shows, stars and stories.",
  Movies: "Feature film presentation.",
  Kids: "Fun, friendly adventures for younger viewers.",
  Documentary: "An in-depth look at the people and places shaping our world.",
  Music: "Non-stop music and live performances.",
  Lifestyle: "Ideas and inspiration for home, food and life.",
};

// --- Build ---------------------------------------------------------------------

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function build() {
  const vodCategories = [];
  const movies = [];
  let movieId = 10001;
  MOVIE_GENRES.forEach((g, gi) => {
    const categoryId = String(100 + gi);
    vodCategories.push({ category_id: categoryId, category_name: g.name, parent_id: 0 });
    for (const title of g.titles) {
      const r = rng(`movie:${title}`);
      const year = g.name === "New Releases" ? r.int(2025, 2026) : r.int(1998, 2025);
      const plot = r.pick(MOVIE_PLOTS[g.name]).replace("{a}", person(r));
      movies.push({
        id: movieId++,
        title,
        year,
        categoryId,
        genre: g.genre,
        plot,
        rating: (r.int(58, 89) / 10).toFixed(1),
        durationSecs: r.int(84, 148) * 60,
        director: person(r),
        cast: [person(r), person(r), person(r), person(r)].join(", "),
        // Most panels add titles over time — newer releases carry a newer timestamp.
        added: NOW - (g.name === "New Releases" ? r.int(1, 20) : r.int(30, 900)) * DAY,
        slug: slug(title),
        palette: gi,
      });
    }
  });

  const seriesCategories = [];
  const series = [];
  let seriesId = 5001;
  let episodeId = 900001;
  SERIES_GENRES.forEach((g, gi) => {
    const categoryId = String(200 + gi);
    seriesCategories.push({ category_id: categoryId, category_name: g.name, parent_id: 0 });
    for (const title of g.titles) {
      const r = rng(`series:${title}`);
      const firstYear = r.int(2012, 2024);
      const seasonCount = r.int(1, 4);
      const seasons = {};
      for (let s = 1; s <= seasonCount; s++) {
        const count = r.int(6, 10);
        seasons[s] = Array.from({ length: count }, (_, i) => {
          const er = rng(`ep:${title}:${s}:${i}`);
          return {
            id: String(episodeId++),
            episode_num: i + 1,
            season: s,
            title: `${title} - S${String(s).padStart(2, "0")}E${String(i + 1).padStart(2, "0")} - ${er.pick(EPISODE_WORDS)}`,
            plot: `${er.pick(["A surprise visitor", "An old rivalry", "A missing file", "An unexpected offer", "A storm warning", "A long-kept secret"])} ${er.pick(["turns the week upside down", "forces a difficult choice", "brings everyone together", "puts the plan at risk", "changes everything"])}.`,
            durationSecs: (g.name === "Kids Series" ? er.int(11, 24) : er.int(38, 58)) * 60,
            airDate: `${firstYear + s - 1}-${String(er.int(1, 12)).padStart(2, "0")}-${String(er.int(1, 28)).padStart(2, "0")}`,
            rating: (er.int(66, 92) / 10).toFixed(1),
          };
        });
      }
      series.push({
        id: seriesId++,
        title,
        year: firstYear,
        categoryId,
        genre: g.genre,
        plot: r.pick(SERIES_PLOTS[gi]).replace("{a}", person(r)),
        rating: (r.int(65, 91) / 10).toFixed(1),
        director: person(r),
        cast: [person(r), person(r), person(r), person(r)].join(", "),
        lastModified: NOW - r.int(1, 200) * DAY,
        seasons,
        slug: slug(title),
        palette: gi + 3,
      });
    }
  });

  const liveCategories = [];
  const channels = [];
  let streamId = 1;
  let number = 101;
  LIVE_GENRES.forEach((g, gi) => {
    const categoryId = String(300 + gi);
    liveCategories.push({ category_id: categoryId, category_name: g.name, parent_id: 0 });
    for (const name of g.channels) {
      channels.push({
        id: streamId++,
        num: number++,
        name,
        categoryId,
        group: g.name,
        epgId: `${slug(name)}.mock`,
        archive: g.archive,
        palette: gi,
      });
    }
    number = Math.ceil(number / 100) * 100 + 1; // each group starts a new hundred
  });

  return { vodCategories, movies, seriesCategories, series, liveCategories, channels };
}

export const catalog = build();

/** A day of programmes for one channel, from `from` to `to` (unix seconds), on 30/60/90-minute slots. */
export function programmesFor(channel, from, to) {
  const titles = PROGRAMMES[channel.group];
  const slotStart = Math.floor(from / 1800) * 1800;
  const list = [];
  for (let start = slotStart; start < to; ) {
    const r = rng(`${channel.id}:${start}`);
    const length = channel.group === "Movies" ? r.pick([90, 120]) : r.pick([30, 30, 60, 60, 90]);
    const stop = start + length * 60;
    list.push({ title: r.pick(titles), description: PROGRAMME_DESCRIPTIONS[channel.group], start, stop, category: channel.group });
    start = stop;
  }
  return list;
}
