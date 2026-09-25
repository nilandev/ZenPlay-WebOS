import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isKidsProfile, type Category, type Channel, type ItemState, type KidsContentKind, type PlatformId, type PlaylistSource, type Profile } from "@core";
import { Check, ChevronRight, KeyRound } from "lucide-react";
import {
  BROWSE_SIDE_PADDING,
  Focusable,
  focusTvTextField,
  MeshBackground,
  TV_TEXT,
  TvTextField,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import { getCatalogCount, getCatalogPage } from "../catalog-store.js";
import { createKidsPolicy, useParentalRevision, type ContentPolicy, type PolicyItem } from "../content-policy.js";
import {
  hasPin,
  loadKidsProfileRules,
  removePin,
  setAllowOtherCategories,
  setCategoryDecision,
  setItemDecision,
} from "../parental-store.js";
import { useCatalogCategories } from "../use-kids-allowed.js";
import { useLiveChannels } from "../use-live-channels.js";
import { useSearchQuery } from "../use-debounced-value.js";
import { ParentalDisclaimer } from "./ParentalDisclaimer.js";
import { PinSetupFlow, verifyParentPin } from "./ParentalFlows.js";
import { PinPad } from "./PinPad.js";

const SCOPE = "parental-controls";
const KIND_LABELS: Record<KidsContentKind, string> = { live: "Live channels", vod: "Movies", series: "Series" };
const ITEM_PAGE_SIZE = 100;

type View =
  | { name: "home" }
  | { name: "review" }
  | { name: "categories"; kind: KidsContentKind }
  | { name: "items"; kind: KidsContentKind; category: Category }
  | { name: "pin-set" }
  | { name: "pin-change-verify" }
  | { name: "pin-change-new" }
  | { name: "pin-remove-verify" };

export interface ParentalControlsScreenProps {
  platform: PlatformId;
  profiles: Profile[];
  sources: PlaylistSource[];
  activeSourceId: string | undefined;
  onBack: () => void;
}

/**
 * Settings → Parental Controls (docs/kids-profile.md §4): per Kids profile
 * and playlist, the review queue, the whitelist picker (categories, then
 * the titles or channels in one), the "kid-friendly titles from other
 * categories" switch, the parent PIN, and the Parental Discretion
 * Disclaimer as a fixed footer. Every change is saved the moment it's made.
 *
 * Delegates to exactly one sub-view at a time, each owning the remote —
 * the same single-input-owner split SettingsScreen/ManageProfilesScreen use.
 */
export function ParentalControlsScreen({ platform, profiles, sources, activeSourceId, onBack }: ParentalControlsScreenProps): JSX.Element {
  const kidsProfiles = useMemo(() => profiles.filter(isKidsProfile), [profiles]);
  const [profileId, setProfileId] = useState<string | undefined>(kidsProfiles[0]?.id);
  const [sourceId, setSourceId] = useState<string | undefined>(activeSourceId ?? sources[0]?.id);
  const [view, setView] = useState<View>({ name: "home" });
  const revision = useParentalRevision();
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];

  const policy = useMemo(() => {
    if (!profileId || !source) return null;
    const rules = loadKidsProfileRules(profileId);
    return createKidsPolicy({ profileId, sourceId: source.id, parent: rules.sources[source.id], allowOtherCategories: rules.allowOtherCategories ?? false, revision });
  }, [profileId, source, revision]);

  const goHome = useCallback(() => setView({ name: "home" }), []);

  if (view.name === "pin-set" || view.name === "pin-change-new") {
    return <PinSetupFlow platform={platform} onDone={goHome} onCancel={goHome} />;
  }
  if (view.name === "pin-change-verify" || view.name === "pin-remove-verify") {
    const isRemove = view.name === "pin-remove-verify";
    return (
      <PinPad
        platform={platform}
        title={isRemove ? "Remove PIN" : "Change PIN"}
        subtitle="Enter the current parent PIN"
        onComplete={async (pin) => {
          const result = await verifyParentPin(pin);
          if (!result.ok) return result;
          if (isRemove) {
            removePin();
            goHome();
          } else {
            setView({ name: "pin-change-new" });
          }
          return result;
        }}
        onCancel={goHome}
      />
    );
  }
  if (policy && source && profileId && view.name !== "home") {
    return <KindData platform={platform} source={source} profileId={profileId} policy={policy} view={view} setView={setView} onHome={goHome} />;
  }

  return (
    <HomeView
      platform={platform}
      kidsProfiles={kidsProfiles}
      profileId={profileId}
      onSelectProfile={setProfileId}
      sources={sources}
      sourceId={source?.id}
      onSelectSource={setSourceId}
      allowOtherCategories={profileId ? (loadKidsProfileRules(profileId).allowOtherCategories ?? false) : false}
      revision={revision}
      setView={setView}
      onBack={onBack}
    />
  );
}

// --- Home ---

function HomeView({
  platform,
  kidsProfiles,
  profileId,
  onSelectProfile,
  sources,
  sourceId,
  onSelectSource,
  allowOtherCategories,
  revision,
  setView,
  onBack,
}: {
  platform: PlatformId;
  kidsProfiles: Profile[];
  profileId: string | undefined;
  onSelectProfile: (id: string) => void;
  sources: PlaylistSource[];
  sourceId: string | undefined;
  onSelectSource: (id: string) => void;
  allowOtherCategories: boolean;
  revision: number;
  setView: (view: View) => void;
  onBack: () => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const pinIsSet = hasPin();
  const hasKids = kidsProfiles.length > 0 && profileId !== undefined;
  const latestRef = useRef({ setView, onSelectProfile, onSelectSource, profileId, allowOtherCategories });
  latestRef.current = { setView, onSelectProfile, onSelectSource, profileId, allowOtherCategories };

  useEffect(() => {
    const rows: Array<Array<{ id: string; onSelect: () => void }>> = [];
    if (kidsProfiles.length > 1) rows.push(kidsProfiles.map((p) => ({ id: `pc-profile:${p.id}`, onSelect: () => latestRef.current.onSelectProfile(p.id) })));
    if (hasKids && sources.length > 1) rows.push(sources.map((s) => ({ id: `pc-source:${s.id}`, onSelect: () => latestRef.current.onSelectSource(s.id) })));
    if (hasKids) {
      rows.push([{ id: "pc-review", onSelect: () => latestRef.current.setView({ name: "review" }) }]);
      for (const kind of ["live", "vod", "series"] as KidsContentKind[]) rows.push([{ id: `pc-kind:${kind}`, onSelect: () => latestRef.current.setView({ name: "categories", kind }) }]);
      rows.push([
        {
          id: "pc-allow-other",
          onSelect: () => {
            const { profileId: id, allowOtherCategories: current } = latestRef.current;
            if (id) setAllowOtherCategories(id, !current);
          },
        },
      ]);
    }
    rows.push(
      pinIsSet
        ? [
            { id: "pc-pin-change", onSelect: () => latestRef.current.setView({ name: "pin-change-verify" }) },
            { id: "pc-pin-remove", onSelect: () => latestRef.current.setView({ name: "pin-remove-verify" }) },
          ]
        : [{ id: "pc-pin-set", onSelect: () => latestRef.current.setView({ name: "pin-set" }) }],
    );
    setGraph(SCOPE, gridNodes(rows));
  }, [setGraph, kidsProfiles, sources, hasKids, pinIsSet, revision]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useRemoteInput(platform, { onBack });

  return (
    <Page title="Parental Controls" subtitle="What each Kids profile can watch, and the parent PIN. Changes are saved as you make them.">
      {!hasKids ? (
        <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2rem" }}>
          No Kids profiles yet. Create one from Who's watching? → Add Profile, and turn on "Kids profile".
        </p>
      ) : (
        <>
          {kidsProfiles.length > 1 && (
            <ChipRow label="Kids profile">
              {kidsProfiles.map((p) => (
                <Chip key={p.id} id={`pc-profile:${p.id}`} label={p.name} isSelected={p.id === profileId} onClick={() => onSelectProfile(p.id)} />
              ))}
            </ChipRow>
          )}
          {sources.length > 1 && (
            <ChipRow label="Playlist">
              {sources.map((s) => (
                <Chip key={s.id} id={`pc-source:${s.id}`} label={s.name} isSelected={s.id === sourceId} onClick={() => onSelectSource(s.id)} />
              ))}
            </ChipRow>
          )}
          <Section title="What they can watch">
            <ActionRow id="pc-review" label="Review queue" description="Categories that need your decision before kids see them" onSelect={() => setView({ name: "review" })} />
            {(["live", "vod", "series"] as KidsContentKind[]).map((kind) => (
              <ActionRow
                key={kind}
                id={`pc-kind:${kind}`}
                label={KIND_LABELS[kind]}
                description="Choose categories, or turn single titles on or off"
                onSelect={() => setView({ name: "categories", kind })}
              />
            ))}
            <ActionRow
              id="pc-allow-other"
              label="Allow kid-friendly titles from other categories"
              description="Titles whose names look child-friendly, even outside the allowed categories — the weakest signal, so off by default"
              value={allowOtherCategories ? "On" : "Off"}
              onSelect={() => profileId && setAllowOtherCategories(profileId, !allowOtherCategories)}
            />
          </Section>
        </>
      )}
      <Section title="Parent PIN">
        <p style={{ fontSize: "1.125rem", color: "var(--text-dim)", margin: "0 0 0.5rem" }}>
          {pinIsSet
            ? "Locked: leaving a Kids profile, managing profiles and these controls ask for the PIN."
            : "Trust mode: no PIN is set, so nothing asks for one. A child could switch to a parent profile."}
        </p>
        {pinIsSet ? (
          <div style={{ display: "flex", gap: "1rem" }}>
            <ActionRow id="pc-pin-change" label="Change PIN" onSelect={() => setView({ name: "pin-change-verify" })} icon />
            <ActionRow id="pc-pin-remove" label="Remove PIN" onSelect={() => setView({ name: "pin-remove-verify" })} icon />
          </div>
        ) : (
          <ActionRow id="pc-pin-set" label="Set PIN" description="Lock parent settings with a 4-digit PIN" onSelect={() => setView({ name: "pin-set" })} icon />
        )}
      </Section>
    </Page>
  );
}

// --- Data for the category/item/review views ---

function KindData({
  platform,
  source,
  profileId,
  policy,
  view,
  setView,
  onHome,
}: {
  platform: PlatformId;
  source: PlaylistSource;
  profileId: string;
  policy: ContentPolicy;
  view: Exclude<View, { name: "home" | "pin-set" | "pin-change-verify" | "pin-change-new" | "pin-remove-verify" }>;
  setView: (view: View) => void;
  onHome: () => void;
}): JSX.Element {
  const { channels } = useLiveChannels(source);
  const fetchedLive = useCatalogCategories(source, "live", true);
  const vod = useCatalogCategories(source, "vod", true);
  const series = useCatalogCategories(source, "series", true);
  // M3U sources have no live category API — their groups are the categories.
  const live = useMemo(() => (fetchedLive.length > 0 ? fetchedLive : groupChannels(channels)), [fetchedLive, channels]);
  const categoriesByKind: Record<KidsContentKind, Category[]> = { live, vod, series };

  if (view.name === "review") {
    return <ReviewView platform={platform} source={source} profileId={profileId} policy={policy} categoriesByKind={categoriesByKind} channels={channels} onBack={onHome} />;
  }
  if (view.name === "categories") {
    return (
      <CategoriesView
        platform={platform}
        source={source}
        profileId={profileId}
        policy={policy}
        kind={view.kind}
        categories={categoriesByKind[view.kind]}
        onOpen={(category) => setView({ name: "items", kind: view.kind, category })}
        onBack={onHome}
      />
    );
  }
  return (
    <ItemsView
      platform={platform}
      source={source}
      profileId={profileId}
      policy={policy}
      kind={view.kind}
      category={view.category}
      categories={categoriesByKind[view.kind]}
      channels={channels}
      onBack={() => setView({ name: "categories", kind: view.kind })}
    />
  );
}

function groupChannels(channels: Channel[]): Category[] {
  const seen = new Map<string, Category>();
  for (const channel of channels) {
    const key = channel.groupTitle ?? "Uncategorized";
    if (!seen.has(key)) seen.set(key, { id: key, name: key, kind: "live" });
  }
  return Array.from(seen.values());
}

// --- Review queue ---

function ReviewView({
  platform,
  source,
  profileId,
  policy,
  categoriesByKind,
  channels,
  onBack,
}: {
  platform: PlatformId;
  source: PlaylistSource;
  profileId: string;
  policy: ContentPolicy;
  categoriesByKind: Record<KidsContentKind, Category[]>;
  channels: Channel[];
  onBack: () => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  // Categories the rules flag for review, plus those blocked by default that a parent can reconsider.
  const entries = useMemo(() => {
    const list: Array<{ kind: KidsContentKind; category: Category }> = [];
    for (const kind of ["live", "vod", "series"] as KidsContentKind[]) {
      for (const category of categoriesByKind[kind]) {
        const state = policy.categoryState(kind, category);
        if (state.verdict === "review" || (state.verdict === "block" && state.autoReason.startsWith("blocked:"))) list.push({ kind, category });
      }
    }
    return list;
  }, [policy, categoriesByKind]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const entriesKey = entries.map((e) => `${e.kind}:${e.category.id}`).join("|");
  useEffect(() => {
    const rows = entriesRef.current.map(({ kind, category }) => [
      { id: `pc-rev-approve:${kind}:${category.id}`, onSelect: () => setCategoryDecision(profileId, source.id, kind, category.id, "approve") },
      { id: `pc-rev-hide:${kind}:${category.id}`, onSelect: () => setCategoryDecision(profileId, source.id, kind, category.id, "reject") },
    ]);
    setGraph(SCOPE, gridNodes(rows));
  }, [setGraph, entriesKey, profileId, source.id]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);
  useRemoteInput(platform, { onBack });

  return (
    <Page title="Review queue" subtitle="Approve a category to show it in this Kids profile, or keep it hidden." showDisclaimer>
      {entries.length === 0 ? (
        <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)" }}>Nothing needs review in this playlist.</p>
      ) : (
        entries.map(({ kind, category }) => {
          const state = policy.categoryState(kind, category);
          return (
            <div key={`${kind}:${category.id}`} style={{ ...panelStyle, display: "flex", alignItems: "center", gap: "1.5rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff" }}>
                  {category.name} <span style={{ fontSize: "1.125rem", color: "var(--text-dim)", fontWeight: 500 }}>· {KIND_LABELS[kind]}</span>
                </div>
                <CategorySample source={source} kind={kind} category={category} channels={channels} />
              </div>
              <DecisionButton id={`pc-rev-approve:${kind}:${category.id}`} label="Approve" isSelected={state.decision === "approve"} onClick={() => setCategoryDecision(profileId, source.id, kind, category.id, "approve")} />
              <DecisionButton id={`pc-rev-hide:${kind}:${category.id}`} label="Keep hidden" isSelected={state.decision === "reject"} onClick={() => setCategoryDecision(profileId, source.id, kind, category.id, "reject")} />
            </div>
          );
        })
      )}
    </Page>
  );
}

/** "42 titles · Frozen, Moana, Encanto" — so a parent can judge a category without opening it. */
function CategorySample({ source, kind, category, channels }: { source: PlaylistSource; kind: KidsContentKind; category: Category; channels: Channel[] }): JSX.Element {
  const [sample, setSample] = useState<{ count: number; names: string[] } | null>(null);
  useEffect(() => {
    if (kind === "live") {
      const inCategory = channels.filter((c) => (c.groupTitle ?? "Uncategorized") === category.id);
      setSample({ count: inCategory.length, names: inCategory.slice(0, 3).map((c) => c.name) });
      return;
    }
    let cancelled = false;
    Promise.all([getCatalogCount(source.id, kind, { categoryId: category.id }), getCatalogPage(source.id, kind as "vod", { categoryId: category.id, offset: 0, limit: 3 })])
      .then(([count, page]) => {
        if (!cancelled) setSample({ count, names: page.map((item) => item.name) });
      })
      .catch(() => {
        if (!cancelled) setSample({ count: 0, names: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, kind, category.id, channels]);
  if (!sample) return <div style={{ fontSize: "1.125rem", color: "var(--text-dim)" }}>…</div>;
  const unit = kind === "live" ? (sample.count === 1 ? "channel" : "channels") : sample.count === 1 ? "title" : "titles";
  return (
    <div style={{ fontSize: "1.125rem", color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {sample.count} {unit}
      {sample.names.length > 0 ? ` · ${sample.names.join(", ")}` : ""}
    </div>
  );
}

// --- Whitelist picker: categories ---

function CategoriesView({
  platform,
  source,
  profileId,
  policy,
  kind,
  categories,
  onOpen,
  onBack,
}: {
  platform: PlatformId;
  source: PlaylistSource;
  profileId: string;
  policy: ContentPolicy;
  kind: KidsContentKind;
  categories: Category[];
  onOpen: (category: Category) => void;
  onBack: () => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const latestRef = useRef({ categories, onOpen });
  latestRef.current = { categories, onOpen };
  const categoriesKey = categories.map((c) => c.id).join("|");

  useEffect(() => {
    const rows = latestRef.current.categories.map((category) => [
      { id: `pc-cat-open:${category.id}`, onSelect: () => latestRef.current.onOpen(category) },
      { id: `pc-cat-allow:${category.id}`, onSelect: () => setCategoryDecision(profileId, source.id, kind, category.id, "approve") },
      { id: `pc-cat-hide:${category.id}`, onSelect: () => setCategoryDecision(profileId, source.id, kind, category.id, "reject") },
      { id: `pc-cat-auto:${category.id}`, onSelect: () => setCategoryDecision(profileId, source.id, kind, category.id, null) },
    ]);
    setGraph(SCOPE, gridNodes(rows));
  }, [setGraph, categoriesKey, profileId, source.id, kind]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);
  useRemoteInput(platform, { onBack });

  return (
    <Page title={KIND_LABELS[kind]} subtitle="Allow or hide whole categories, or open one to choose single titles. Auto follows the Kids rules." showDisclaimer>
      {categories.length === 0 && <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)" }}>No categories in this playlist yet.</p>}
      {categories.map((category) => {
        const state = policy.categoryState(kind, category);
        return (
          <div key={category.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <OpenRow id={`pc-cat-open:${category.id}`} label={category.name} status={categoryStatus(state)} reason={describeReason(state.reason)} onClick={() => onOpen(category)} />
            </div>
            <DecisionButton id={`pc-cat-allow:${category.id}`} label="Allow" isSelected={state.decision === "approve"} onClick={() => setCategoryDecision(profileId, source.id, kind, category.id, "approve")} />
            <DecisionButton id={`pc-cat-hide:${category.id}`} label="Hide" isSelected={state.decision === "reject"} onClick={() => setCategoryDecision(profileId, source.id, kind, category.id, "reject")} />
            <DecisionButton id={`pc-cat-auto:${category.id}`} label="Auto" isSelected={!state.decision} onClick={() => setCategoryDecision(profileId, source.id, kind, category.id, null)} />
          </div>
        );
      })}
    </Page>
  );
}

function categoryStatus(state: { allowed: boolean; verdict: string; decision?: string }): string {
  if (state.decision === "approve") return "Approved";
  if (state.decision === "reject") return "Hidden";
  if (state.verdict === "allow") return "Auto-included";
  if (state.verdict === "review") return "Needs review";
  return "Hidden";
}

/** A rule reason ("keyword:cartoon") in words a parent can act on. */
export function describeReason(reason: string): string {
  const [kind, ...rest] = reason.split(":");
  const detail = rest.join(":");
  switch (kind) {
    case "category":
      return "A kids category";
    case "keyword":
      return `Matches “${detail}”`;
    case "review":
      return "Listed for review";
    case "blocked":
      return "Hidden by default";
    case "mature":
      return `Mature: “${detail}”`;
    case "channel":
      return `Kids channel “${detail}”`;
    case "parent":
      return detail === "approve" || detail === "include" ? "You turned it on" : "You turned it off";
    case "other-category":
      return "Kid-friendly title from another category";
    case "rating":
      return `Rated ${detail}`;
    default:
      return "No kids match";
  }
}

// --- Whitelist picker: titles/channels in one category ---

function ItemsView({
  platform,
  source,
  profileId,
  policy,
  kind,
  category,
  categories,
  channels,
  onBack,
}: {
  platform: PlatformId;
  source: PlaylistSource;
  profileId: string;
  policy: ContentPolicy;
  kind: KidsContentKind;
  category: Category;
  categories: Category[];
  channels: Channel[];
  onBack: () => void;
}): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [query, setQuery] = useState("");
  const trimmedQuery = useSearchQuery(query);
  const [items, setItems] = useState<PolicyItem[]>([]);
  const [limit, setLimit] = useState(ITEM_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const searchId = "pc-items-search";
  const moreId = "pc-items-more";

  // A search looks across the whole playlist (the name-prefix index for movies/series), so a parent can switch on any title.
  useEffect(() => {
    if (kind === "live") {
      const needle = trimmedQuery.toLowerCase();
      const list = trimmedQuery ? channels.filter((c) => c.name.toLowerCase().includes(needle)) : channels.filter((c) => (c.groupTitle ?? "Uncategorized") === category.id);
      setItems(list.slice(0, limit));
      setHasMore(list.length > limit);
      return;
    }
    let cancelled = false;
    const query = trimmedQuery ? { namePrefix: trimmedQuery } : { categoryId: category.id };
    getCatalogPage(source.id, kind as "vod", { ...query, offset: 0, limit: limit + 1 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.slice(0, limit));
        setHasMore(page.length > limit);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, source.id, category.id, channels, trimmedQuery, limit]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemsKey = items.map((i) => i.id).join("|");
  const policyRef = useRef(policy);
  policyRef.current = policy;

  useEffect(() => {
    const toggle = (item: PolicyItem) => {
      const state = policyRef.current.itemState(kind, item, categoriesById);
      setItemDecision(profileId, source.id, kind, item.id, state.allowed ? "exclude" : "include");
    };
    const rows: Array<Array<{ id: string; onSelect: () => void }>> = [];
    if (kind !== "live" || channels.length > 0) rows.push([{ id: searchId, onSelect: () => focusTvTextField(searchId) }]);
    for (const item of itemsRef.current) {
      rows.push([
        { id: `pc-item:${item.id}`, onSelect: () => toggle(item) },
        { id: `pc-item-auto:${item.id}`, onSelect: () => setItemDecision(profileId, source.id, kind, item.id, null) },
      ]);
    }
    if (hasMore) rows.push([{ id: moreId, onSelect: () => setLimit((l) => l + ITEM_PAGE_SIZE) }]);
    setGraph(SCOPE, gridNodes(rows));
  }, [setGraph, itemsKey, hasMore, profileId, source.id, kind, categoriesById, channels.length]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);
  useRemoteInput(platform, { onBack });

  return (
    <Page title={trimmedQuery ? `Results for “${trimmedQuery}”` : category.name} subtitle="OK turns a title on or off for this Kids profile. Auto goes back to the category's rules." showDisclaimer>
      <div style={{ maxWidth: "40rem", marginBottom: "1rem" }}>
        <TvTextField id={searchId} label="Search this playlist" value={query} onChange={setQuery} platform={platform} placeholder="Title starts with…" />
      </div>
      {items.length === 0 && <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)" }}>{trimmedQuery ? "Nothing matches." : "Nothing in this category."}</p>}
      {items.map((item) => {
        const state: ItemState = policy.itemState(kind, item, categoriesById);
        const hasOverride = state.reason.startsWith("parent:");
        return (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ToggleItemRow
                id={`pc-item:${item.id}`}
                label={item.name}
                isOn={state.allowed}
                reason={describeReason(state.reason)}
                onClick={() => setItemDecision(profileId, source.id, kind, item.id, state.allowed ? "exclude" : "include")}
              />
            </div>
            <DecisionButton id={`pc-item-auto:${item.id}`} label="Auto" isSelected={!hasOverride} onClick={() => setItemDecision(profileId, source.id, kind, item.id, null)} />
          </div>
        );
      })}
      {hasMore && <ActionRow id={moreId} label="Show more" onSelect={() => setLimit((l) => l + ITEM_PAGE_SIZE)} />}
    </Page>
  );
}

// --- Shared layout and controls ---

/** Rows of focus ids → a graph: Left/Right within a row, Up/Down keeping the column where the next row has one. */
function gridNodes(rows: Array<Array<{ id: string; onSelect: () => void }>>): FocusNode[] {
  const at = (row: Array<{ id: string }> | undefined, index: number) => row?.[Math.min(index, row.length - 1)]?.id;
  return rows.flatMap((row, r) =>
    row.map((item, index) => ({
      id: item.id,
      neighbors: { up: at(rows[r - 1], index), down: at(rows[r + 1], index), left: row[index - 1]?.id, right: row[index + 1]?.id },
      onSelect: item.onSelect,
    })),
  );
}

const panelStyle: React.CSSProperties = {
  padding: "1rem 1.5rem",
  borderRadius: "1.125rem",
  background: "rgba(255,255,255,0.05)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
};

function Page({ title, subtitle, showDisclaimer = true, children }: { title: string; subtitle?: string; showDisclaimer?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", boxSizing: "border-box", padding: `3rem ${BROWSE_SIDE_PADDING} 0` }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.5rem 0 2rem" }}>{subtitle}</p>}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "2rem" }}>{children}</div>
        {showDisclaimer && (
          // A fixed footer, always visible below the picker (docs/kids-profile.md §5.2 #3).
          <div style={{ position: "sticky", bottom: 0, padding: "1rem 0 2rem", background: "linear-gradient(180deg, rgba(8,9,11,0) 0%, rgba(8,9,11,0.92) 30%)" }}>
            <ParentalDisclaimer compact />
          </div>
        )}
      </div>
    </MeshBackground>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: "1.75rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 800, color: "rgba(235,236,242,0.55)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 1rem" }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>{children}</div>
    </section>
  );
}

function rowStyle(isFocused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1.5rem",
    width: "100%",
    minHeight: "4.5rem",
    padding: "0.875rem 1.5rem",
    boxSizing: "border-box",
    border: "none",
    borderRadius: "1.125rem",
    background: isFocused ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.07)",
    boxShadow: isFocused ? "0 1rem 2rem -0.75rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.06)",
    color: isFocused ? "#0b0c10" : "#ffffff",
    textAlign: "left",
    cursor: "pointer",
  };
}

function dim(isFocused: boolean): string {
  return isFocused ? "rgba(11,12,16,0.65)" : "rgba(235,236,242,0.6)";
}

function ActionRow({ id, label, description, value, icon, onSelect }: { id: string; label: string; description?: string; value?: string; icon?: boolean; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button type="button" onClick={onSelect} style={rowStyle(isFocused)}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.875rem", minWidth: 0 }}>
          {icon && <KeyRound size="1.5rem" aria-hidden />}
          <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
            <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{label}</span>
            {description && <span style={{ fontSize: "1.125rem", color: dim(isFocused) }}>{description}</span>}
          </span>
        </span>
        {value ? <span style={{ fontSize: TV_TEXT, fontWeight: 700 }}>{value}</span> : <ChevronRight size="1.75rem" aria-hidden />}
      </button>
    </Focusable>
  );
}

function OpenRow({ id, label, status, reason, onClick }: { id: string; label: string; status: string; reason: string; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button type="button" onClick={onClick} style={rowStyle(isFocused)}>
        <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
          <span style={{ fontSize: "1.375rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          <span style={{ fontSize: "1.125rem", color: dim(isFocused) }}>
            {status} · {reason}
          </span>
        </span>
        <ChevronRight size="1.75rem" aria-hidden />
      </button>
    </Focusable>
  );
}

function ToggleItemRow({ id, label, isOn, reason, onClick }: { id: string; label: string; isOn: boolean; reason: string; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button type="button" role="switch" aria-checked={isOn} aria-label={label} onClick={onClick} style={rowStyle(isFocused)}>
        <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
          <span style={{ fontSize: "1.375rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          <span style={{ fontSize: "1.125rem", color: dim(isFocused) }}>{reason}</span>
        </span>
        <span style={{ fontSize: TV_TEXT, fontWeight: 800, color: isOn ? (isFocused ? "#0a7a4a" : "#5ee0a0") : isFocused ? "#b3261e" : "#ff8a8a" }}>{isOn ? "Shown" : "Hidden"}</span>
      </button>
    </Focusable>
  );
}

function DecisionButton({ id, label, isSelected, onClick }: { id: string; label: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto", flexShrink: 0 }}>
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1.25rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: isSelected || isFocused ? 700 : 500,
          whiteSpace: "nowrap",
          background: isFocused ? "#ffffff" : isSelected ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
          color: isFocused ? "#0b0c10" : isSelected ? "#ffffff" : "rgba(235,236,242,0.75)",
          transform: isFocused ? "scale(1.06)" : "scale(1)",
          transition: "transform 160ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        {isSelected && <Check size="1.25rem" strokeWidth={3} aria-hidden />}
        {label}
      </button>
    </Focusable>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
      <span style={{ fontSize: TV_TEXT, fontWeight: 600, color: "var(--text-dim)", minWidth: "10rem" }}>{label}</span>
      {children}
    </div>
  );
}

function Chip({ id, label, isSelected, onClick }: { id: string; label: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  return <DecisionButton id={id} label={label} isSelected={isSelected} onClick={onClick} />;
}
