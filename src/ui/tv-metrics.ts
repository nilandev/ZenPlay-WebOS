/**
 * Shared "10-foot" sizing for the poster browse screens (Movies, Series):
 * one place that decides how big posters, gaps and margins are, so shelves
 * and grids line up exactly and a density change is a one-line edit.
 *
 * Everything is in rem, which index.html scales with viewport width (1rem =
 * 16px at 1920px wide), so the layout keeps the same proportions on 720p,
 * 1080p and 4K TVs instead of shrinking as the screen gets bigger.
 */

/** Posters per row. ~6 is typical for portrait artwork on TV (Netflix/Prime/tvOS) — big enough to read titles and recognise art from the sofa. */
export const POSTER_COLUMNS = 6;
/** Right margin of browse content; also clears TV overscan. */
export const BROWSE_SIDE_PADDING = "3.5rem";
/** Width of the collapsed category rail (see CategoryRail) — always on screen at the left edge. */
export const CATEGORY_RAIL_COLLAPSED_WIDTH = "5rem";
/** Width of the category rail when expanded over the content. */
export const CATEGORY_RAIL_EXPANDED_WIDTH = "28rem";
/** Where browse content starts: after the collapsed rail, plus breathing room. */
export const BROWSE_CONTENT_LEFT = `calc(${CATEGORY_RAIL_COLLAPSED_WIDTH} + 2rem)`;
/**
 * Gap between posters in a row or grid column. Sized so a focused poster
 * (scaled 1.1 by LiftSurface, ~0.85rem wider each side) still keeps clear
 * space to its neighbours instead of pressing into them.
 */
export const BROWSE_GAP = "2.25rem";
/**
 * Gap between grid rows — larger than BROWSE_GAP because a focused poster
 * grows ~1.25rem up and down, and its lift shadow falls onto the row below.
 */
export const BROWSE_ROW_GAP = "3rem";
/**
 * One poster's width: the space right of the collapsed rail split into
 * POSTER_COLUMNS, after the margins and gaps. Used for shelf cards so they match the grid's columns
 * exactly (the grid itself just uses repeat(POSTER_COLUMNS, 1fr)).
 */
export const POSTER_WIDTH = `calc((100vw - ${BROWSE_CONTENT_LEFT} - ${BROWSE_SIDE_PADDING} - ${POSTER_COLUMNS - 1} * ${BROWSE_GAP}) / ${POSTER_COLUMNS})`;

/** Episode cards per row on the series detail page (landscape 16:9, so fewer than posters). */
export const EPISODE_COLUMNS = 4;
/** One episode card's width: full width (no category rail on the detail page) split into EPISODE_COLUMNS. */
export const EPISODE_WIDTH = `calc((100vw - 2 * ${BROWSE_SIDE_PADDING} - ${EPISODE_COLUMNS - 1} * ${BROWSE_GAP}) / ${EPISODE_COLUMNS})`;

/** Body-text floor for browse chrome (menus, search, labels): 22px at 1080p. */
export const TV_TEXT = "1.375rem";
/** Row/section titles: 28px at 1080p. */
export const TV_HEADING = "1.75rem";
