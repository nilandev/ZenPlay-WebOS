import { Clapperboard, Film, Heart, History, ListVideo, Settings, Tv, type LucideIcon } from "lucide-react";

/**
 * One icon per app section, shared by Home's menu tiles and each section's
 * artwork placeholders — so a movie with no poster shows the same icon the
 * user tapped on Home to get there, and the two can never drift apart.
 */
export const SECTION_ICONS = {
  live: Tv,
  movies: Film,
  series: Clapperboard,
  guide: ListVideo,
  favourites: Heart,
  history: History,
  settings: Settings,
} satisfies Record<string, LucideIcon>;
