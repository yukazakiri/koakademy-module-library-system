import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { IconTile } from "@/components/reui/icon-tile";
import { BeamSearch } from "@/components/spectrumui/beam-search";
import { KbdKey } from "@/components/spectrumui/kbd-key";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { isAdministratorPortalRole } from "@/lib/portal-role";
import { cn } from "@/lib/utils";
import { index as adminLibraryIndex } from "@/routes/administrators/library";
import { index as libraryIndex } from "@/routes/library";
import {
    authenticate as authenticateBook,
    favorite as favoriteBook,
    read as readBook,
    show as showBook,
    unfavorite as unfavoriteBook,
} from "@/routes/library/books";
import type { User } from "@/types/user";
import { Head, Link, router } from "@inertiajs/react";
import {
    ArrowUpDown,
    BookMarked,
    BookOpen,
    Bookmark,
    ChevronLeft,
    ChevronRight,
    Clock,
    Compass,
    Globe2,
    Heart,
    LayoutGrid,
    LibraryBig,
    List,
    Lock,
    RotateCcw,
    Search,
    ShieldCheck,
    SlidersHorizontal,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AccountGateDialog, type AccountGateReason } from "./components/account-gate-dialog";
import { BookCard, type LibraryBookCardData } from "./components/book-card";
import { BookCover } from "./components/book-cover";
import { LibraryShell } from "./components/library-shell";

interface Pagination<T> {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
    prev_page_url: string | null;
    next_page_url: string | null;
}

interface Filters {
    search: string;
    category_id: number | null;
    year: number | null;
    availability: string;
    collection: string;
    sort: string;
}

interface AccessProps {
    is_authenticated: boolean;
    login_url: string;
    signup_url: string;
}

interface Props {
    auth?: { user?: User | null };
    books: Pagination<LibraryBookCardData>;
    filters: Filters;
    options: {
        categories: { id: number; name: string }[];
        years: number[];
    };
    stats: {
        catalog_books: number;
        available_online: number;
        favorites: number;
    };
    access?: AccessProps;
}

const numberFormatter = new Intl.NumberFormat();

export default function DigitalLibraryIndex({ auth, books, filters, options, stats, access }: Props) {
    const user = auth?.user ?? null;
    const isAuthenticated = Boolean(user);
    const loginUrl = access?.login_url ?? "/login";
    const signupUrl = access?.signup_url ?? "/signup";

    const [search, setSearch] = useState(filters.search);
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
    const [gateBook, setGateBook] = useState<LibraryBookCardData | null>(null);
    const [gateReason, setGateReason] = useState<AccountGateReason>("favorite");
    const [gateOpen, setGateOpen] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isLibrarianOrAdmin = user ? isAdministratorPortalRole(user.role) : false;

    useEffect(() => {
        setSearch(filters.search);
    }, [filters.search]);

    useEffect(() => {
        return () => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const activeElement = document.activeElement;
            const isTyping =
                activeElement instanceof HTMLInputElement ||
                activeElement instanceof HTMLTextAreaElement ||
                (activeElement instanceof HTMLElement && activeElement.isContentEditable);

            if ((event.key === "/" && !isTyping) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
                event.preventDefault();
                searchInputRef.current?.focus();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const visitWith = (changes: Partial<Filters>) => {
        const next = { ...filters, ...changes };
        router.get(
            libraryIndex.url({
                query: {
                    search: next.search || undefined,
                    category_id: next.category_id || undefined,
                    year: next.year || undefined,
                    availability: next.availability === "all" ? undefined : next.availability,
                    collection: next.collection === "all" ? undefined : next.collection,
                    sort: next.sort === "title" ? undefined : next.sort,
                },
            }),
            {},
            {
                preserveScroll: true,
                preserveState: true,
                replace: true,
                only: ["books", "filters", "stats"],
            },
        );
    };

    const handleSearchChange = (value: string) => {
        setSearch(value);
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => {
            visitWith({ search: value });
        }, 300);
    };

    const handleSearchClear = () => {
        setSearch("");
        if (searchTimer.current) clearTimeout(searchTimer.current);
        visitWith({ search: "" });
    };

    const clearAllFilters = () => {
        setSearch("");
        setMobileFiltersOpen(false);
        router.get(libraryIndex.url(), {}, { preserveState: true, replace: true });
    };

    const openAuthGate = (book: LibraryBookCardData, reason: "favorite" | "read" = "favorite") => {
        setGateBook(book);
        setGateReason(reason);
        setGateOpen(true);
    };

    const secondaryFilterCount =
        (filters.category_id !== null ? 1 : 0) + (filters.year !== null ? 1 : 0) + (filters.sort !== "title" ? 1 : 0);

    const hasFilters =
        filters.search !== "" ||
        filters.category_id !== null ||
        filters.year !== null ||
        filters.availability !== "all" ||
        filters.collection !== "all" ||
        filters.sort !== "title";

    const quickShelves = [
        {
            id: "all",
            label: "All Catalog",
            count: stats.catalog_books,
            icon: LibraryBig,
            isActive: filters.collection === "all" && filters.availability === "all",
            apply: () => visitWith({ collection: "all", availability: "all" }),
        },
        {
            id: "online",
            label: "Read Online",
            count: stats.available_online,
            icon: BookOpen,
            isActive: filters.availability === "online" && filters.collection === "all",
            apply: () => visitWith({ collection: "all", availability: "online" }),
        },
        ...(isAuthenticated
            ? [
                  {
                      id: "favorites",
                      label: "Saved Shelf",
                      count: stats.favorites,
                      icon: Heart,
                      isActive: filters.collection === "favorites",
                      apply: () => visitWith({ collection: "favorites", availability: "all" }),
                  },
                  {
                      id: "recent",
                      label: "Recently Read",
                      count: null,
                      icon: Clock,
                      isActive: filters.collection === "recent",
                      apply: () => visitWith({ collection: "recent", availability: "all" }),
                  },
              ]
            : []),
        {
            id: "catalog_only",
            label: "Physical Copies",
            count: Math.max(0, stats.catalog_books - stats.available_online),
            icon: BookMarked,
            isActive: filters.availability === "catalog" && filters.collection === "all",
            apply: () => visitWith({ collection: "all", availability: "catalog" }),
        },
    ];

    const currentCategory = options.categories.find((c) => c.id === filters.category_id);

    return (
        <LibraryShell user={user} loginUrl={loginUrl} signupUrl={signupUrl}>
            <Head title="Digital Library • KoAkademy" />

            <div className="flex flex-col gap-4 sm:gap-5">
                {/* ── Scholarly Hero Banner & Stats ── */}
                <Frame variant="default" spacing="sm" className="border-border/80 bg-card/70 overflow-hidden shadow-xs">
                    <FramePanel className="via-background relative overflow-hidden bg-linear-to-br from-amber-500/8 to-sky-500/8 p-4 sm:p-5 md:p-6">
                        <div className="relative z-10 flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
                            <div className="max-w-2xl space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    {isAuthenticated ? (
                                        <Badge variant="outline" radius="full" size="sm" className="bg-background/80 text-muted-foreground">
                                            <ShieldCheck className="mr-1 size-3 text-emerald-600 dark:text-emerald-400" />
                                            Signed-in Campus Access
                                        </Badge>
                                    ) : (
                                        <Badge
                                            variant="success-light"
                                            radius="full"
                                            size="sm"
                                            className="font-semibold tracking-wide"
                                        >
                                            <Globe2 className="mr-1 size-3" />
                                            Open Digital Reading Room
                                        </Badge>
                                    )}

                                    {isLibrarianOrAdmin && (
                                        <Link
                                            href={adminLibraryIndex.url()}
                                            className={cn(
                                                buttonVariants({ variant: "outline", size: "xs" }),
                                                "border-primary/30 text-primary hover:bg-primary/10 gap-1 rounded-full",
                                            )}
                                        >
                                            <Compass className="size-3" />
                                            Librarian Operations
                                        </Link>
                                    )}
                                </div>

                                <div>
                                    <h1 className="text-foreground font-serif text-xl font-semibold tracking-tight text-balance sm:text-2xl md:text-3xl">
                                        Academic Repository & Digital eBooks
                                    </h1>
                                    <p className="text-muted-foreground mt-1.5 max-w-xl text-xs leading-relaxed text-pretty sm:text-sm">
                                        {isAuthenticated ? (
                                            <>
                                                Welcome back, <span className="text-foreground font-medium">{user?.name}</span>. Read
                                                published PDF eBooks online, download licensed editions, and keep your saved shelf synced.
                                            </>
                                        ) : (
                                            <>
                                                Read published PDF eBooks right in your browser — no account required.{" "}
                                                <a
                                                    href={loginUrl}
                                                    className="text-foreground hover:text-primary font-medium underline underline-offset-4 transition-colors"
                                                >
                                                    Sign in
                                                </a>{" "}
                                                to download copies and save bookmarks.
                                            </>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* ── Balanced Quick Stats ── */}
                            <div
                                className={cn(
                                    "grid gap-2 sm:gap-2.5 lg:min-w-80",
                                    isAuthenticated ? "grid-cols-3" : "grid-cols-2",
                                )}
                            >
                                <div className="border-border/60 bg-background/85 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 shadow-2xs backdrop-blur-xs sm:flex-col sm:items-stretch sm:gap-1 sm:p-2.5">
                                    <div className="flex items-center gap-2 sm:justify-between">
                                        <IconTile variant="soft" size="sm" className="text-primary size-7 sm:size-8">
                                            <LibraryBig />
                                        </IconTile>
                                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide sm:hidden">
                                            Titles
                                        </span>
                                        <span className="text-foreground hidden font-serif text-xl font-bold tabular-nums sm:inline">
                                            {numberFormatter.format(stats.catalog_books)}
                                        </span>
                                    </div>
                                    <span className="text-foreground font-serif text-lg font-bold tabular-nums sm:hidden">
                                        {numberFormatter.format(stats.catalog_books)}
                                    </span>
                                    <span className="text-muted-foreground hidden text-[11px] font-semibold tracking-wide sm:block">
                                        Catalog Titles
                                    </span>
                                </div>

                                <div className="border-border/60 bg-background/85 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 shadow-2xs backdrop-blur-xs sm:flex-col sm:items-stretch sm:gap-1 sm:p-2.5">
                                    <div className="flex items-center gap-2 sm:justify-between">
                                        <IconTile variant="soft" size="sm" className="size-7 text-emerald-600 sm:size-8 dark:text-emerald-400">
                                            <BookOpen />
                                        </IconTile>
                                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide sm:hidden">
                                            eBooks
                                        </span>
                                        <span className="text-foreground hidden font-serif text-xl font-bold tabular-nums sm:inline">
                                            {numberFormatter.format(stats.available_online)}
                                        </span>
                                    </div>
                                    <span className="text-foreground font-serif text-lg font-bold tabular-nums sm:hidden">
                                        {numberFormatter.format(stats.available_online)}
                                    </span>
                                    <span className="text-muted-foreground hidden text-[11px] font-semibold tracking-wide sm:block">
                                        Online eBooks
                                    </span>
                                </div>

                                {isAuthenticated && (
                                    <div className="border-border/60 bg-background/85 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 shadow-2xs backdrop-blur-xs sm:flex-col sm:items-stretch sm:gap-1 sm:p-2.5">
                                        <div className="flex items-center gap-2 sm:justify-between">
                                            <IconTile variant="soft" size="sm" className="size-7 text-rose-500 sm:size-8">
                                                <Heart />
                                            </IconTile>
                                            <span className="text-muted-foreground text-[11px] font-semibold tracking-wide sm:hidden">
                                                Saved
                                            </span>
                                            <span className="text-foreground hidden font-serif text-xl font-bold tabular-nums sm:inline">
                                                {numberFormatter.format(stats.favorites)}
                                            </span>
                                        </div>
                                        <span className="text-foreground font-serif text-lg font-bold tabular-nums sm:hidden">
                                            {numberFormatter.format(stats.favorites)}
                                        </span>
                                        <span className="text-muted-foreground hidden text-[11px] font-semibold tracking-wide sm:block">
                                            Saved Shelf
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </FramePanel>
                </Frame>

                {/* ── Search & Filtering Deck ── */}
                <Frame variant="default" spacing="sm" className="border-border/80 bg-card/75 shadow-xs">
                    <FramePanel className="space-y-2.5 p-3 sm:p-3.5 md:p-4">
                        {/* ── Shelf Tabs (Horizontally scrollable on mobile) ── */}
                        <div className="flex scrollbar-none -mx-1 items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
                            {quickShelves.map((shelf) => {
                                const Icon = shelf.icon;
                                return (
                                    <button
                                        key={shelf.id}
                                        type="button"
                                        onClick={shelf.apply}
                                        className={cn(
                                            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors select-none active:scale-[0.97]",
                                            shelf.isActive
                                                ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                                                : "bg-muted/65 text-muted-foreground hover:bg-muted hover:text-foreground",
                                        )}
                                    >
                                        <Icon className="size-3.5" />
                                        <span>{shelf.label}</span>
                                        {shelf.count !== null && (
                                            <span
                                                className={cn(
                                                    "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums",
                                                    shelf.isActive
                                                        ? "bg-primary-foreground/20 text-primary-foreground"
                                                        : "bg-background/85 text-foreground",
                                                )}
                                            >
                                                {numberFormatter.format(shelf.count)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── Search & Desktop Filter Row ── */}
                        <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-[1.8fr_repeat(3,minmax(8.5rem,1fr))_auto] lg:items-center lg:gap-3">
                            <div className="min-w-0">
                                <BeamSearch
                                    ref={searchInputRef}
                                    value={search}
                                    onChange={handleSearchChange}
                                    onClear={handleSearchClear}
                                    placeholder="Search title, author, call number, or ISBN…"
                                    size="default"
                                    className="bg-background/90"
                                    trailing={
                                        <div className="hidden items-center gap-1 sm:flex">
                                            <KbdKey size="sm">/</KbdKey>
                                        </div>
                                    }
                                />
                            </div>

                            {/* Desktop Selects */}
                            <div className="hidden lg:block">
                                <Select
                                    value={filters.category_id ? String(filters.category_id) : "all"}
                                    onValueChange={(val) => visitWith({ category_id: val === "all" ? null : Number(val) })}
                                >
                                    <SelectTrigger className="bg-background/90 h-10 w-full rounded-lg text-xs font-medium">
                                        <SelectValue placeholder="All Categories" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Categories</SelectItem>
                                        {options.categories.map((cat) => (
                                            <SelectItem key={cat.id} value={String(cat.id)}>
                                                {cat.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="hidden lg:block">
                                <Select
                                    value={filters.year ? String(filters.year) : "all"}
                                    onValueChange={(val) => visitWith({ year: val === "all" ? null : Number(val) })}
                                >
                                    <SelectTrigger className="bg-background/90 h-10 w-full rounded-lg text-xs font-medium">
                                        <SelectValue placeholder="All Years" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Years</SelectItem>
                                        {options.years.map((year) => (
                                            <SelectItem key={year} value={String(year)}>
                                                {year}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="hidden lg:block">
                                <Select value={filters.sort} onValueChange={(val) => visitWith({ sort: val })}>
                                    <SelectTrigger className="bg-background/90 h-10 w-full rounded-lg text-xs font-medium">
                                        <div className="flex items-center gap-1.5 truncate">
                                            <ArrowUpDown className="text-muted-foreground size-3 shrink-0" />
                                            <SelectValue />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="title">Title (A–Z)</SelectItem>
                                        <SelectItem value="year_newest">Newest Publication</SelectItem>
                                        <SelectItem value="year_oldest">Oldest Publication</SelectItem>
                                        <SelectItem value="recently_added">Recently Catalogued</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Compact Mobile Controls Row + Desktop View Toggle */}
                            <div className="flex items-center justify-between gap-2 lg:justify-end">
                                {/* Mobile Filter Sheet Trigger */}
                                <div className="flex items-center gap-2 lg:hidden">
                                    <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                                        <SheetTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="bg-background/90 h-10 gap-2 rounded-lg px-3 text-xs font-medium"
                                            >
                                                <SlidersHorizontal className="size-3.5" />
                                                <span>Filters & Sort</span>
                                                {secondaryFilterCount > 0 && (
                                                    <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums">
                                                        {secondaryFilterCount}
                                                    </span>
                                                )}
                                            </Button>
                                        </SheetTrigger>
                                        <SheetContent side="bottom" className="rounded-t-2xl px-5 pb-6">
                                            <SheetHeader className="text-left">
                                                <SheetTitle className="font-serif text-lg">Filter & Sort Catalog</SheetTitle>
                                                <SheetDescription className="text-xs">
                                                    Narrow results by subject category, publication year, or sort order.
                                                </SheetDescription>
                                            </SheetHeader>

                                            <div className="mt-5 space-y-4">
                                                <div className="space-y-1.5">
                                                    <label className="text-muted-foreground text-xs font-semibold">Category</label>
                                                    <Select
                                                        value={filters.category_id ? String(filters.category_id) : "all"}
                                                        onValueChange={(val) => visitWith({ category_id: val === "all" ? null : Number(val) })}
                                                    >
                                                        <SelectTrigger className="h-11 w-full rounded-xl text-sm">
                                                            <SelectValue placeholder="All Categories" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="all">All Categories</SelectItem>
                                                            {options.categories.map((cat) => (
                                                                <SelectItem key={cat.id} value={String(cat.id)}>
                                                                    {cat.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <label className="text-muted-foreground text-xs font-semibold">Publication Year</label>
                                                    <Select
                                                        value={filters.year ? String(filters.year) : "all"}
                                                        onValueChange={(val) => visitWith({ year: val === "all" ? null : Number(val) })}
                                                    >
                                                        <SelectTrigger className="h-11 w-full rounded-xl text-sm">
                                                            <SelectValue placeholder="All Years" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="all">All Years</SelectItem>
                                                            {options.years.map((year) => (
                                                                <SelectItem key={year} value={String(year)}>
                                                                    {year}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <label className="text-muted-foreground text-xs font-semibold">Sort Order</label>
                                                    <Select value={filters.sort} onValueChange={(val) => visitWith({ sort: val })}>
                                                        <SelectTrigger className="h-11 w-full rounded-xl text-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="title">Title (A–Z)</SelectItem>
                                                            <SelectItem value="year_newest">Newest Publication</SelectItem>
                                                            <SelectItem value="year_oldest">Oldest Publication</SelectItem>
                                                            <SelectItem value="recently_added">Recently Catalogued</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <SheetFooter className="mt-6 flex-row gap-2">
                                                {hasFilters && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={clearAllFilters}
                                                        className="h-11 flex-1 rounded-xl"
                                                    >
                                                        Reset all
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    onClick={() => setMobileFiltersOpen(false)}
                                                    className="h-11 flex-1 rounded-xl font-semibold"
                                                >
                                                    Show {numberFormatter.format(books.total)} titles
                                                </Button>
                                            </SheetFooter>
                                        </SheetContent>
                                    </Sheet>

                                    {hasFilters && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={clearAllFilters}
                                            className="text-muted-foreground h-10 gap-1 rounded-lg px-2.5 text-xs"
                                        >
                                            <RotateCcw className="size-3.5" />
                                            Reset
                                        </Button>
                                    )}
                                </div>

                                {/* View Toggle + Desktop Reset */}
                                <div className="flex items-center gap-1.5">
                                    <div className="border-border/80 bg-muted/40 inline-flex rounded-lg border p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setViewMode("grid")}
                                            className={cn(
                                                "flex size-9 items-center justify-center rounded-md transition-colors",
                                                viewMode === "grid"
                                                    ? "bg-background text-foreground shadow-2xs"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                            aria-label="Grid view"
                                            title="Grid view"
                                        >
                                            <LayoutGrid className="size-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setViewMode("list")}
                                            className={cn(
                                                "flex size-9 items-center justify-center rounded-md transition-colors",
                                                viewMode === "list"
                                                    ? "bg-background text-foreground shadow-2xs"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                            aria-label="List view"
                                            title="Academic list view"
                                        >
                                            <List className="size-4" />
                                        </button>
                                    </div>

                                    {hasFilters && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={clearAllFilters}
                                            className="text-muted-foreground hover:text-foreground hidden h-10 w-10 lg:inline-flex"
                                            aria-label="Reset all filters"
                                            title="Reset all filters"
                                        >
                                            <RotateCcw className="size-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── Active Filter Chips ── */}
                        {hasFilters && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                                <span className="text-muted-foreground mr-1 text-[11px] font-semibold tracking-wider uppercase">Active:</span>
                                {filters.search && (
                                    <Badge variant="outline" radius="full" size="sm" className="bg-background gap-1">
                                        <span>“{filters.search}”</span>
                                        <button
                                            type="button"
                                            onClick={handleSearchClear}
                                            className="hover:text-destructive text-muted-foreground"
                                            aria-label="Clear search query"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                )}
                                {currentCategory && (
                                    <Badge variant="outline" radius="full" size="sm" className="bg-background gap-1">
                                        <span>{currentCategory.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => visitWith({ category_id: null })}
                                            className="hover:text-destructive text-muted-foreground"
                                            aria-label="Clear category filter"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                )}
                                {filters.year && (
                                    <Badge variant="outline" radius="full" size="sm" className="bg-background gap-1">
                                        <span>{filters.year}</span>
                                        <button
                                            type="button"
                                            onClick={() => visitWith({ year: null })}
                                            className="hover:text-destructive text-muted-foreground"
                                            aria-label="Clear year filter"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                )}
                                {filters.availability !== "all" && (
                                    <Badge variant="outline" radius="full" size="sm" className="bg-background gap-1">
                                        <span>{filters.availability === "online" ? "Online eBooks" : "Physical Only"}</span>
                                        <button
                                            type="button"
                                            onClick={() => visitWith({ availability: "all" })}
                                            className="hover:text-destructive text-muted-foreground"
                                            aria-label="Clear availability filter"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                )}
                                {filters.collection !== "all" && (
                                    <Badge variant="outline" radius="full" size="sm" className="bg-background gap-1">
                                        <span>{filters.collection === "favorites" ? "Saved Shelf" : "Recently Read"}</span>
                                        <button
                                            type="button"
                                            onClick={() => visitWith({ collection: "all" })}
                                            className="hover:text-destructive text-muted-foreground"
                                            aria-label="Clear collection filter"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                )}
                            </div>
                        )}
                    </FramePanel>
                </Frame>

                {/* ── Catalog Results ── */}
                <section aria-labelledby="catalog-results-heading" className="space-y-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
                        <h2 id="catalog-results-heading" className="text-foreground font-serif text-lg font-semibold tracking-tight sm:text-xl md:text-2xl">
                            {filters.collection === "favorites"
                                ? "Your Saved Shelf"
                                : filters.collection === "recent"
                                  ? "Recently Read"
                                  : filters.availability === "online"
                                    ? "Read Online Digital eBooks"
                                    : "Library Catalog"}
                        </h2>
                        <p className="text-muted-foreground text-xs tabular-nums sm:text-sm">
                            {books.total === 0
                                ? "No matching titles"
                                : `Showing ${numberFormatter.format(books.from ?? 0)}–${numberFormatter.format(books.to ?? 0)} of ${numberFormatter.format(books.total)}`}
                        </p>
                    </div>

                    {/* ── Grid View (2-col mobile, scales gracefully on tablet & desktop) ── */}
                    {books.data.length > 0 && viewMode === "grid" && (
                        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                            {books.data.map((book, index) => (
                                <BookCard
                                    key={book.id}
                                    book={book}
                                    priority={index < 6}
                                    isAuthenticated={isAuthenticated}
                                    onRequireAuth={openAuthGate}
                                />
                            ))}
                        </div>
                    )}

                    {/* ── List View ── */}
                    {books.data.length > 0 && viewMode === "list" && (
                        <Frame variant="default" spacing="xs" className="border-border/80 bg-card/70 overflow-hidden shadow-xs">
                            <div className="divide-border/60 divide-y">
                                {books.data.map((book) => {
                                    const readRequiresAuth = Boolean(
                                        book.available_online && book.requires_account_to_read && !isAuthenticated,
                                    );

                                    return (
                                        <div
                                            key={book.id}
                                            className="hover:bg-muted/35 flex flex-col gap-3 p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex min-w-0 items-center gap-3.5">
                                                <Link
                                                    href={showBook.url(book.id)}
                                                    prefetch
                                                    className="h-18 w-13 shrink-0 overflow-hidden rounded-md shadow-2xs"
                                                >
                                                    <BookCover title={book.title} author={book.author} coverUrl={book.cover_image_url} />
                                                </Link>
                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Link
                                                            href={showBook.url(book.id)}
                                                            prefetch
                                                            className="text-foreground hover:text-primary line-clamp-1 font-serif text-sm font-semibold transition-colors sm:text-base"
                                                        >
                                                            {book.title}
                                                        </Link>
                                                        {book.available_online ? (
                                                            readRequiresAuth ? (
                                                                <Badge
                                                                    variant="outline"
                                                                    size="xs"
                                                                    radius="full"
                                                                    className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                                                                >
                                                                    <Lock className="size-2.5" />
                                                                    Sign in to Read
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="success-light" size="xs" radius="full">
                                                                    Read Online
                                                                </Badge>
                                                            )
                                                        ) : (
                                                            <Badge variant="invert-light" size="xs" radius="full">
                                                                In Library
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-muted-foreground truncate text-xs">
                                                        {book.author || "Unknown author"}
                                                        {book.category && <span> · {book.category}</span>}
                                                        {book.publication_year && <span className="tabular-nums"> · {book.publication_year}</span>}
                                                    </p>
                                                    <p className="text-muted-foreground/85 line-clamp-1 text-xs">
                                                        {book.description || "No catalog synopsis."}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                                                {readRequiresAuth ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => openAuthGate(book, "read")}
                                                        className="h-9 gap-1.5 rounded-lg text-xs font-semibold transition-transform active:scale-[0.96]"
                                                    >
                                                        <Lock className="size-3.5" />
                                                        Sign in to Read
                                                    </Button>
                                                ) : (
                                                    <Link
                                                        href={book.available_online ? readBook.url(book.id) : showBook.url(book.id)}
                                                        prefetch
                                                        className={cn(
                                                            buttonVariants({ variant: book.available_online ? "default" : "outline", size: "sm" }),
                                                            "h-9 gap-1.5 rounded-lg text-xs font-semibold transition-transform active:scale-[0.96]",
                                                        )}
                                                    >
                                                        {book.available_online ? <BookOpen className="size-3.5" /> : <Bookmark className="size-3.5" />}
                                                        {book.available_online ? "Read Now" : "Details"}
                                                    </Link>
                                                )}
                                                <Button
                                                    type="button"
                                                    size="icon-sm"
                                                    variant="ghost"
                                                    className="size-9 rounded-lg"
                                                    onClick={() => {
                                                        if (!isAuthenticated) {
                                                            openAuthGate(book, "favorite");
                                                            return;
                                                        }
                                                        const next = !book.is_favorite;
                                                        const routeDefinition = next ? favoriteBook(book.id) : unfavoriteBook(book.id);
                                                        router.visit(routeDefinition.url, {
                                                            method: routeDefinition.method,
                                                            preserveScroll: true,
                                                            preserveState: true,
                                                            only: ["books", "stats"],
                                                        });
                                                    }}
                                                    aria-label={book.is_favorite ? "Remove from shelf" : "Save to shelf"}
                                                >
                                                    <Heart className={cn("size-4", book.is_favorite && "fill-rose-500 text-rose-500")} />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Frame>
                    )}

                    {/* ── Empty State ── */}
                    {books.data.length === 0 && (
                        <Frame variant="default" spacing="default" className="border-border/80 bg-card/60">
                            <FramePanel className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl p-8 text-center">
                                <IconTile variant="soft" size="lg" className="text-primary">
                                    <Search />
                                </IconTile>
                                <div className="max-w-md space-y-1">
                                    <h3 className="text-foreground font-serif text-lg font-semibold">No titles match your filters</h3>
                                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                                        Try another search phrase, switch categories, or browse all published online eBooks.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                                    <Button type="button" variant="outline" size="sm" onClick={clearAllFilters} className="h-10 rounded-lg">
                                        <RotateCcw className="mr-1.5 size-3.5" />
                                        Clear filters
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        onClick={() => visitWith({ availability: "online", collection: "all" })}
                                        className="h-10 rounded-lg"
                                    >
                                        <BookOpen className="mr-1.5 size-3.5" />
                                        Browse Online eBooks
                                    </Button>
                                </div>
                            </FramePanel>
                        </Frame>
                    )}

                    {/* ── Pagination ── */}
                    {books.last_page > 1 && (
                        <Frame variant="ghost" spacing="xs" className="pt-2">
                            <FramePanel className="border-border/60 bg-card/50 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-muted-foreground text-center text-xs tabular-nums sm:text-left">
                                    Page <span className="text-foreground font-medium">{books.current_page}</span> of{" "}
                                    <span className="text-foreground font-medium">{books.last_page}</span> ({numberFormatter.format(books.total)}{" "}
                                    titles)
                                </p>
                                <nav className="flex items-center justify-center gap-2" aria-label="Catalog pagination">
                                    {books.prev_page_url ? (
                                        <Link
                                            href={books.prev_page_url}
                                            preserveScroll
                                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 gap-1 rounded-lg text-xs sm:h-9")}
                                        >
                                            <ChevronLeft className="size-3.5" />
                                            Previous
                                        </Link>
                                    ) : (
                                        <Button variant="outline" size="sm" disabled className="h-10 gap-1 rounded-lg text-xs sm:h-9">
                                            <ChevronLeft className="size-3.5" />
                                            Previous
                                        </Button>
                                    )}

                                    <span className="bg-primary/10 text-primary rounded-md px-2.5 py-1.5 text-xs font-semibold tabular-nums">
                                        {books.current_page}
                                    </span>

                                    {books.next_page_url ? (
                                        <Link
                                            href={books.next_page_url}
                                            preserveScroll
                                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 gap-1 rounded-lg text-xs sm:h-9")}
                                        >
                                            Next
                                            <ChevronRight className="size-3.5" />
                                        </Link>
                                    ) : (
                                        <Button variant="outline" size="sm" disabled className="h-10 gap-1 rounded-lg text-xs sm:h-9">
                                            Next
                                            <ChevronRight className="size-3.5" />
                                        </Button>
                                    )}
                                </nav>
                            </FramePanel>
                        </Frame>
                    )}
                </section>
            </div>

            <AccountGateDialog
                open={gateOpen}
                onOpenChange={setGateOpen}
                reason={gateReason}
                bookTitle={gateBook?.title}
                signInUrl={
                    gateReason === "read" && gateBook
                        ? authenticateBook.url(gateBook.id, { query: { from: "read", action: "read" } })
                        : loginUrl
                }
                signUpUrl={signupUrl}
            />
        </LibraryShell>
    );
}
