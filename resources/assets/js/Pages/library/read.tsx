import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { progress, show } from "@/routes/library/books";
import { destroy as destroyBookmark, store as storeBookmark } from "@/routes/library/books/bookmarks";
import type { User } from "@/types/user";
import { Head, Link } from "@inertiajs/react";
import {
    ArrowLeft,
    Bookmark,
    BookOpenText,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    FileText,
    Fullscreen,
    List,
    LoaderCircle,
    Lock,
    Maximize2,
    Minimize2,
    Minus,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    RefreshCw,
    Rows3,
    Search,
    SlidersHorizontal,
    Sun,
    SunMedium,
    X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { AccountGateDialog, type AccountGateReason } from "./components/account-gate-dialog";
import { PdfPageCanvas, type ReaderFitMode, type ReaderSurfaceTheme } from "./components/reader/pdf-page-canvas";
import { ReaderSidebarPanel } from "./components/reader/reader-sidebar-panel";
import { type ReaderBookmark, useGuestReadingState } from "./components/reader/use-guest-reading-state";

interface Props {
    auth?: { user?: User | null };
    book: {
        id: number;
        title: string;
        author: string | null;
        downloads_allowed: boolean;
        file_size_bytes?: number | null;
    };
    reader: {
        content_url: string;
        download_url: string | null;
        last_page: number;
        total_pages: number | null;
        bookmarks: ReaderBookmark[];
        sync_enabled: boolean;
        is_guest: boolean;
        can_download: boolean;
        download_requires_auth: boolean;
        authenticate_url: string;
        ready_action: "download" | null;
        is_authenticated: boolean;
        login_url: string;
        signup_url: string;
    };
}

type ViewMode = "single" | "scroll";

const SURFACE_STYLES: Record<ReaderSurfaceTheme, { canvasBg: string; label: string }> = {
    paper: {
        canvasBg: "bg-zinc-100/90 dark:bg-zinc-950",
        label: "Paper",
    },
    sepia: {
        canvasBg: "bg-[#efe7d6] dark:bg-[#221d16]",
        label: "Sepia",
    },
    dark: {
        canvasBg: "bg-zinc-950",
        label: "Dark",
    },
};

export default function DigitalLibraryReader({ book, reader }: Props) {
    const isGuest = reader.is_guest;
    const { initialLastPage, guestBookmarks, saveGuestLastPage, toggleGuestBookmark, removeGuestBookmark } = useGuestReadingState(
        book.id,
        isGuest,
    );

    const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(() => Math.max(1, isGuest ? (initialLastPage ?? 1) : reader.last_page));
    const [pageInput, setPageInput] = useState<string>(() => String(Math.max(1, isGuest ? (initialLastPage ?? 1) : reader.last_page)));
    const [pageCount, setPageCount] = useState<number>(reader.total_pages ?? 0);
    const [zoom, setZoom] = useState<number>(1);
    const [fitMode, setFitMode] = useState<ReaderFitMode>("width");
    const [viewMode, setViewMode] = useState<ViewMode>("single");
    const [surfaceTheme, setSurfaceTheme] = useState<ReaderSurfaceTheme>("paper");
    const [loading, setLoading] = useState<boolean>(true);
    const [reloadToken, setReloadToken] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(true);
    const [mobileSheetOpen, setMobileSheetOpen] = useState<boolean>(false);
    const [sidebarTab, setSidebarTab] = useState<"pages" | "bookmarks" | "search">("pages");
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    const [authBookmarks, setAuthBookmarks] = useState<ReaderBookmark[]>(reader.bookmarks);
    const bookmarks = isGuest ? guestBookmarks : authBookmarks;

    const [searchQuery, setSearchQuery] = useState<string>("");
    const [searching, setSearching] = useState<boolean>(false);
    const [searchResults, setSearchResults] = useState<number[]>([]);

    const [guestNoticeDismissed, setGuestNoticeDismissed] = useState<boolean>(false);
    const [readyBannerDismissed, setReadyBannerDismissed] = useState<boolean>(false);
    const [gateDialogOpen, setGateDialogOpen] = useState<boolean>(false);
    const [gateReason, setGateReason] = useState<AccountGateReason>("download");

    const [stageMetrics, setStageMetrics] = useState<{ width: number; height: number }>({
        width: 820,
        height: 760,
    });

    const readerShellRef = useRef<HTMLDivElement>(null);
    const mainScrollRef = useRef<HTMLDivElement>(null);
    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const programmaticScrollRef = useRef<boolean>(false);

    const isCurrentBookmarked = useMemo(
        () => bookmarks.some((bookmark) => bookmark.page === currentPage),
        [bookmarks, currentPage],
    );

    const progressPercent = pageCount > 0 ? Math.min(100, Math.round((currentPage / pageCount) * 100)) : 0;

    // Sync page input when currentPage changes
    useEffect(() => {
        setPageInput(String(currentPage));
    }, [currentPage]);

    // Measure reading viewport for crisp fit-width and fit-page rendering
    useEffect(() => {
        const container = mainScrollRef.current;
        if (!container) return;

        const updateMetrics = () => {
            const horizontalPadding = window.innerWidth >= 768 ? 48 : 16;
            const verticalPadding = window.innerWidth >= 768 ? 48 : 24;
            const measuredWidth = Math.max(260, container.clientWidth - horizontalPadding);
            const measuredHeight = Math.max(320, container.clientHeight - verticalPadding);

            setStageMetrics({
                width: measuredWidth,
                height: measuredHeight,
            });
        };

        updateMetrics();

        const observer = new ResizeObserver(updateMetrics);
        observer.observe(container);

        return () => observer.disconnect();
    }, [desktopSidebarOpen]);

    // Track native fullscreen changes
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onFullscreenChange = () => setIsFullscreen(window.document.fullscreenElement !== null);
        window.document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => window.document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    // Dynamically load pdfjs-dist on the client only (keeps Vite SSR builds safe)
    useEffect(() => {
        let cancelled = false;
        let activeTask: { destroy: () => Promise<void> } | null = null;

        setLoading(true);
        setError(null);

        void (async () => {
            try {
                const [pdfjs, workerModule] = await Promise.all([
                    import("pdfjs-dist"),
                    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
                ]);

                if (cancelled) return;

                pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

                const loadingTask = pdfjs.getDocument({
                    url: reader.content_url,
                    disableStream: false,
                    disableAutoFetch: false,
                    rangeChunkSize: 65536,
                });
                activeTask = loadingTask;

                const loadedPdf = await loadingTask.promise;

                if (cancelled) {
                    void loadingTask.destroy();
                    return;
                }

                setPdfDocument(loadedPdf);
                setPageCount(loadedPdf.numPages);
                setCurrentPage((page) => Math.min(Math.max(1, page), loadedPdf.numPages));
                setLoading(false);
            } catch {
                if (!cancelled) {
                    setError(
                        "The PDF could not be loaded right now. Check your connection or try reloading the reader.",
                    );
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            if (activeTask) {
                void activeTask.destroy();
            }
        };
    }, [reader.content_url, reloadToken]);

    // Persist reading progress (localStorage for guests, backend API for signed-in users)
    useEffect(() => {
        if (pageCount < 1 || loading) return;

        if (isGuest) {
            saveGuestLastPage(currentPage);
            return;
        }

        if (!reader.sync_enabled) return;

        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);

        progressTimerRef.current = setTimeout(() => {
            void window.axios.put(progress.url(book.id), {
                last_page: currentPage,
                total_pages: pageCount,
            });
        }, 700);

        return () => {
            if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        };
    }, [book.id, currentPage, isGuest, loading, pageCount, reader.sync_enabled, saveGuestLastPage]);

    const goToPage = useCallback(
        (targetPage: number, closeMobileSheet = false) => {
            const clamped = Math.min(Math.max(1, targetPage), Math.max(1, pageCount));
            setCurrentPage(clamped);

            if (closeMobileSheet) {
                setMobileSheetOpen(false);
            }

            if (viewMode === "scroll" && mainScrollRef.current) {
                const targetEl = mainScrollRef.current.querySelector<HTMLElement>(`[data-page-number="${clamped}"]`);
                if (targetEl) {
                    programmaticScrollRef.current = true;
                    targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    window.setTimeout(() => {
                        programmaticScrollRef.current = false;
                    }, 450);
                }
            } else if (mainScrollRef.current) {
                mainScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
            }
        },
        [pageCount, viewMode],
    );

    const handleVisibleScrollPage = useCallback((visiblePage: number) => {
        if (programmaticScrollRef.current) return;
        setCurrentPage(visiblePage);
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoom((value) => Math.max(0.6, Number((value - 0.15).toFixed(2))));
    }, []);

    const handleZoomIn = useCallback(() => {
        setZoom((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))));
    }, []);

    const handleResetView = useCallback(() => {
        setFitMode("width");
        setZoom(1);
    }, []);

    const toggleBookmark = useCallback(async () => {
        if (isGuest) {
            toggleGuestBookmark(currentPage);
            return;
        }

        const existing = authBookmarks.find((bookmark) => bookmark.page === currentPage);

        if (existing) {
            await window.axios.delete(destroyBookmark.url({ book: book.id, bookmark: existing.id }));
            setAuthBookmarks((items) => items.filter((bookmark) => bookmark.id !== existing.id));
            return;
        }

        const response = await window.axios.post<ReaderBookmark>(storeBookmark.url(book.id), {
            page: currentPage,
            label: `Page ${currentPage}`,
        });
        setAuthBookmarks((items) => [...items, response.data].sort((a, b) => a.page - b.page));
    }, [authBookmarks, book.id, currentPage, isGuest, toggleGuestBookmark]);

    const handleRemoveBookmark = useCallback(
        async (bookmark: ReaderBookmark) => {
            if (isGuest) {
                removeGuestBookmark(bookmark.id);
                return;
            }

            await window.axios.delete(destroyBookmark.url({ book: book.id, bookmark: bookmark.id }));
            setAuthBookmarks((items) => items.filter((item) => item.id !== bookmark.id));
        },
        [book.id, isGuest, removeGuestBookmark],
    );

    const searchDocument = useCallback(async () => {
        const term = searchQuery.trim().toLocaleLowerCase();
        if (!pdfDocument || term === "") {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        const matches: number[] = [];

        try {
            for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
                const page = await pdfDocument.getPage(pageNumber);
                const content = await page.getTextContent();
                const pageText = content.items
                    .map((item) => ("str" in item ? item.str : ""))
                    .join(" ")
                    .toLocaleLowerCase();

                if (pageText.includes(term)) {
                    matches.push(pageNumber);
                }
            }
            setSearchResults(matches);
        } finally {
            setSearching(false);
        }
    }, [pdfDocument, searchQuery]);

    const toggleFullscreen = useCallback(async () => {
        if (!readerShellRef.current) return;
        if (window.document.fullscreenElement !== null) {
            await window.document.exitFullscreen();
            return;
        }
        await readerShellRef.current.requestFullscreen();
    }, []);

    // Keyboard shortcuts for desktop power reading
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.metaKey ||
                event.ctrlKey
            ) {
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "PageUp") {
                if (viewMode === "single") {
                    event.preventDefault();
                    goToPage(currentPage - 1);
                }
            } else if (event.key === "ArrowRight" || event.key === "PageDown") {
                if (viewMode === "single") {
                    event.preventDefault();
                    goToPage(currentPage + 1);
                }
            } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                handleZoomIn();
            } else if (event.key === "-") {
                event.preventDefault();
                handleZoomOut();
            } else if (event.key === "0") {
                event.preventDefault();
                handleResetView();
            } else if (event.key.toLowerCase() === "b") {
                event.preventDefault();
                void toggleBookmark();
            } else if (event.key.toLowerCase() === "f") {
                event.preventDefault();
                void toggleFullscreen();
            } else if (event.key === "/") {
                event.preventDefault();
                setSidebarTab("search");
                if (window.innerWidth >= 768) {
                    setDesktopSidebarOpen(true);
                } else {
                    setMobileSheetOpen(true);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentPage, goToPage, handleResetView, handleZoomIn, handleZoomOut, toggleBookmark, toggleFullscreen, viewMode]);

    // Mobile horizontal swipe navigation in Single-Page mode when not zoomed in
    const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
        if (viewMode !== "single" || zoom > 1.05 || event.touches.length !== 1) return;
        touchStartRef.current = {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
        };
    };

    const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
        if (!touchStartRef.current || viewMode !== "single" || zoom > 1.05) {
            touchStartRef.current = null;
            return;
        }

        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        touchStartRef.current = null;

        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (dx < 0 && currentPage < pageCount) {
                goToPage(currentPage + 1);
            } else if (dx > 0 && currentPage > 1) {
                goToPage(currentPage - 1);
            }
        }
    };

    const openGate = (reason: AccountGateReason) => {
        setGateReason(reason);
        setGateDialogOpen(true);
    };

    // Cap fit-width page width on large desktop monitors so single-column typography stays comfortable
    const effectiveCanvasWidth = fitMode === "width" ? Math.min(stageMetrics.width, 900) : stageMetrics.width;

    const sidebarElement = (
        <ReaderSidebarPanel
            document={pdfDocument}
            pageCount={pageCount}
            currentPage={currentPage}
            activeTab={sidebarTab}
            onTabChange={setSidebarTab}
            bookmarks={bookmarks}
            isGuest={isGuest}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searching={searching}
            searchResults={searchResults}
            onSearchSubmit={() => void searchDocument()}
            onSelectPage={(pageNumber) => goToPage(pageNumber, true)}
            onRemoveBookmark={(bookmark) => void handleRemoveBookmark(bookmark)}
            onPromptSync={
                isGuest
                    ? () => {
                          setMobileSheetOpen(false);
                          openGate("bookmark");
                      }
                    : undefined
            }
        />
    );

    return (
        <>
            <Head title={`Read ${book.title}`} />

            <div ref={readerShellRef} className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
                {/* Top Progress Hairline */}
                <div className="bg-muted h-0.5 w-full shrink-0 overflow-hidden">
                    <div
                        className="bg-primary h-full transition-[width] duration-200 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* Top Reader Header */}
                <header className="border-border/80 bg-card/95 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2.5 backdrop-blur-md sm:px-4">
                    {/* Left: Back + Sidebar Toggle + Book Title */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                        <Link
                            href={show.url(book.id)}
                            className={cn(
                                buttonVariants({ variant: "ghost", size: "icon" }),
                                "size-10 shrink-0 rounded-xl transition-transform active:scale-[0.96]",
                            )}
                            aria-label="Back to book details"
                        >
                            <ArrowLeft className="size-4" />
                        </Link>

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="hidden size-9 shrink-0 rounded-xl md:inline-flex"
                            onClick={() => setDesktopSidebarOpen((open) => !open)}
                            aria-label={desktopSidebarOpen ? "Hide reader sidebar" : "Show reader sidebar"}
                        >
                            {desktopSidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </Button>

                        <div className="min-w-0">
                            <h1 className="truncate font-serif text-sm font-semibold tracking-tight sm:text-[15px]">{book.title}</h1>
                            <p className="text-muted-foreground hidden truncate text-[11px] sm:block">
                                {book.author || "Unknown author"}
                                {pageCount > 0 ? ` · ${progressPercent}% read` : ""}
                            </p>
                        </div>
                    </div>

                    {/* Center: Desktop Reading Controls */}
                    <div className="hidden items-center gap-1.5 md:flex">
                        {/* Page Navigation */}
                        <div className="border-border/80 bg-background flex items-center rounded-xl border p-0.5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-8 rounded-lg"
                                disabled={currentPage <= 1}
                                onClick={() => goToPage(currentPage - 1)}
                                aria-label="Previous page"
                            >
                                <ChevronLeft className="size-4" />
                            </Button>

                            <form
                                className="flex items-center gap-1 px-1 text-xs tabular-nums"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    const parsed = Number.parseInt(pageInput, 10);
                                    if (!Number.isNaN(parsed)) {
                                        goToPage(parsed);
                                    } else {
                                        setPageInput(String(currentPage));
                                    }
                                }}
                            >
                                <label className="sr-only" htmlFor="desktop-page-input">
                                    Current page
                                </label>
                                <Input
                                    id="desktop-page-input"
                                    value={pageInput}
                                    inputMode="numeric"
                                    onChange={(event) => setPageInput(event.target.value)}
                                    onBlur={() => {
                                        const parsed = Number.parseInt(pageInput, 10);
                                        if (!Number.isNaN(parsed)) {
                                            goToPage(parsed);
                                        } else {
                                            setPageInput(String(currentPage));
                                        }
                                    }}
                                    className="h-7 w-11 border-0 bg-transparent px-1 text-center text-xs font-semibold shadow-none focus-visible:ring-1"
                                />
                                <span className="text-muted-foreground pr-1.5">/ {pageCount || "—"}</span>
                            </form>

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-8 rounded-lg"
                                disabled={currentPage >= pageCount}
                                onClick={() => goToPage(currentPage + 1)}
                                aria-label="Next page"
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>

                        {/* View Mode Switcher */}
                        <div className="border-border/80 bg-background flex items-center rounded-xl border p-0.5">
                            <Button
                                type="button"
                                variant={viewMode === "single" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
                                onClick={() => setViewMode("single")}
                                aria-pressed={viewMode === "single"}
                                title="Single page mode"
                            >
                                <FileText className="size-3.5" />
                                <span className="hidden xl:inline">Page</span>
                            </Button>
                            <Button
                                type="button"
                                variant={viewMode === "scroll" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
                                onClick={() => setViewMode("scroll")}
                                aria-pressed={viewMode === "scroll"}
                                title="Continuous scroll mode"
                            >
                                <Rows3 className="size-3.5" />
                                <span className="hidden xl:inline">Scroll</span>
                            </Button>
                        </div>

                        {/* Zoom & Fit Controls */}
                        <div className="border-border/80 bg-background flex items-center rounded-xl border p-0.5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-8 rounded-lg"
                                onClick={handleZoomOut}
                                aria-label="Zoom out"
                            >
                                <Minus className="size-3.5" />
                            </Button>
                            <button
                                type="button"
                                onClick={handleResetView}
                                className="text-muted-foreground hover:text-foreground w-12 text-center text-xs font-medium tabular-nums transition-colors"
                                title="Reset zoom (0)"
                            >
                                {Math.round(zoom * 100)}%
                            </button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-8 rounded-lg"
                                onClick={handleZoomIn}
                                aria-label="Zoom in"
                            >
                                <Plus className="size-3.5" />
                            </Button>
                            <div className="bg-border mx-0.5 h-4 w-px" />
                            <Button
                                type="button"
                                variant={fitMode === "page" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 rounded-lg px-2 text-xs"
                                onClick={() => {
                                    setFitMode((mode) => (mode === "page" ? "width" : "page"));
                                    setZoom(1);
                                }}
                                title={fitMode === "page" ? "Switch to Fit Width" : "Switch to Fit Page"}
                            >
                                {fitMode === "page" ? "Fit Page" : "Fit Width"}
                            </Button>
                        </div>
                    </div>

                    {/* Right: Theme, Bookmark, Fullscreen, Download */}
                    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                        {/* Desktop Surface Theme Popover */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="hidden size-9 rounded-xl md:inline-flex"
                                    aria-label="Reading theme"
                                >
                                    {surfaceTheme === "dark" ? (
                                        <Moon className="size-4" />
                                    ) : surfaceTheme === "sepia" ? (
                                        <SunMedium className="size-4" />
                                    ) : (
                                        <Sun className="size-4" />
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-56 rounded-xl p-3">
                                <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                                    Reading surface
                                </p>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {(["paper", "sepia", "dark"] as ReaderSurfaceTheme[]).map((theme) => (
                                        <button
                                            key={theme}
                                            type="button"
                                            onClick={() => setSurfaceTheme(theme)}
                                            className={cn(
                                                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                                                surfaceTheme === theme
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border/70 hover:bg-muted",
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "size-5 rounded-full ring-1 ring-black/15",
                                                    theme === "paper" && "bg-white",
                                                    theme === "sepia" && "bg-[#f3ead8]",
                                                    theme === "dark" && "bg-zinc-900 ring-white/25",
                                                )}
                                            />
                                            {SURFACE_STYLES[theme].label}
                                        </button>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>

                        {/* Desktop Bookmark */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="hidden size-9 rounded-xl md:inline-flex"
                            onClick={() => void toggleBookmark()}
                            aria-label={isCurrentBookmarked ? "Remove page bookmark" : "Bookmark current page"}
                        >
                            <Bookmark className={cn("size-4", isCurrentBookmarked && "fill-amber-500 text-amber-600")} />
                        </Button>

                        {/* Desktop Fullscreen */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="hidden size-9 rounded-xl md:inline-flex"
                            onClick={() => void toggleFullscreen()}
                            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 className="size-4" /> : <Fullscreen className="size-4" />}
                        </Button>

                        {/* Mobile Quick Search Button */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 rounded-xl md:hidden"
                            onClick={() => {
                                setSidebarTab("search");
                                setMobileSheetOpen(true);
                            }}
                            aria-label="Search inside book"
                        >
                            <Search className="size-4" />
                        </Button>

                        {/* Download Action (Auth = Direct Download, Guest = Account Gate) */}
                        {reader.can_download && reader.download_url ? (
                            <a
                                href={reader.download_url}
                                className={cn(
                                    buttonVariants({ size: "sm" }),
                                    "h-9 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-xs transition-transform active:scale-[0.96]",
                                )}
                                aria-label="Download PDF"
                            >
                                <Download className="size-3.5" />
                                <span className="hidden sm:inline">Download PDF</span>
                            </a>
                        ) : reader.download_requires_auth ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-9 gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-transform active:scale-[0.96] sm:px-3"
                                onClick={() => openGate("download")}
                                aria-label="Sign in to download PDF"
                            >
                                <Lock className="text-muted-foreground size-3" />
                                <Download className="size-3.5" />
                                <span className="hidden sm:inline">Download PDF</span>
                            </Button>
                        ) : null}
                    </div>
                </header>

                {/* Post-login Ready-to-Download Banner */}
                {reader.ready_action === "download" && reader.can_download && reader.download_url && !readyBannerDismissed && (
                    <div className="border-b border-emerald-500/25 bg-emerald-500/10 px-3 py-2 sm:px-4">
                        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-xs text-emerald-950 dark:text-emerald-100">
                                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span className="truncate font-medium">
                                    Signed in! Your PDF download is ready.
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <a
                                    href={reader.download_url}
                                    className={cn(buttonVariants({ size: "sm" }), "h-7 gap-1.5 rounded-lg px-2.5 text-xs font-semibold")}
                                >
                                    <Download className="size-3" />
                                    Download now
                                </a>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-7 rounded-lg"
                                    onClick={() => setReadyBannerDismissed(true)}
                                    aria-label="Dismiss banner"
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Guest Free Reading Notice Strip */}
                {isGuest && !guestNoticeDismissed && (
                    <div className="border-border/70 bg-muted/45 border-b px-3 py-1.5 sm:px-4">
                        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 text-xs">
                            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 truncate">
                                <BookOpenText className="text-primary size-3.5 shrink-0" />
                                <span className="truncate">
                                    <span className="text-foreground font-medium">Free open reader</span>
                                    <span className="hidden sm:inline"> · Progress saves locally on this device.</span>
                                </span>
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openGate(reader.download_requires_auth ? "download" : "bookmark")}
                                    className="text-primary font-semibold whitespace-nowrap underline-offset-4 hover:underline"
                                >
                                    {reader.download_requires_auth ? "Sign in to download" : "Sign in to sync"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setGuestNoticeDismissed(true)}
                                    className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
                                    aria-label="Dismiss reading notice"
                                >
                                    <X className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Workspace: Sidebar + Canvas Stage */}
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                    {/* Desktop Persistent Sidebar */}
                    {desktopSidebarOpen && (
                        <aside className="border-border/80 bg-card hidden w-64 shrink-0 flex-col border-r md:flex lg:w-72">
                            {sidebarElement}
                        </aside>
                    )}

                    {/* Main Document Stage */}
                    <main
                        ref={mainScrollRef}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={cn(
                            "relative flex min-w-0 flex-1 flex-col items-center overflow-auto p-2 sm:p-4 md:p-6 transition-colors duration-200",
                            SURFACE_STYLES[surfaceTheme].canvasBg,
                        )}
                    >
                        {loading && (
                            <div className="text-muted-foreground my-auto flex flex-col items-center justify-center gap-3 py-16 text-center">
                                <LoaderCircle className="text-primary size-8 animate-spin" />
                                <div>
                                    <p className="text-foreground text-sm font-medium">Loading eBook pages…</p>
                                    <p className="text-muted-foreground mt-0.5 text-xs">Streaming directly into the browser reader</p>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="bg-card border-border my-auto max-w-md rounded-2xl border p-6 text-center shadow-sm sm:p-8">
                                <div className="bg-destructive/10 text-destructive mx-auto flex size-12 items-center justify-center rounded-2xl">
                                    <X className="size-6" />
                                </div>
                                <h2 className="mt-4 font-serif text-xl font-semibold">Reader unavailable</h2>
                                <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">{error}</p>
                                <div className="mt-5 flex flex-wrap justify-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="gap-1.5 rounded-xl"
                                        onClick={() => setReloadToken((token) => token + 1)}
                                    >
                                        <RefreshCw className="size-3.5" />
                                        Try again
                                    </Button>
                                    <Link
                                        href={show.url(book.id)}
                                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-xl")}
                                    >
                                        Back to book details
                                    </Link>
                                </div>
                            </div>
                        )}

                        {!loading && !error && pdfDocument && viewMode === "single" && (
                            <div className="relative flex w-full flex-1 flex-col items-center justify-start">
                                {pageCount > 1 && (
                                    <>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            disabled={currentPage <= 1}
                                            onClick={() => goToPage(currentPage - 1)}
                                            aria-label="Turn to previous page"
                                            className="bg-card/85 hover:bg-card fixed top-1/2 left-4 z-20 hidden size-11 -translate-y-1/2 rounded-full shadow-md backdrop-blur transition-transform active:scale-[0.95] xl:inline-flex"
                                            style={desktopSidebarOpen ? { left: "19rem" } : undefined}
                                        >
                                            <ChevronLeft className="size-5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            disabled={currentPage >= pageCount}
                                            onClick={() => goToPage(currentPage + 1)}
                                            aria-label="Turn to next page"
                                            className="bg-card/85 hover:bg-card fixed top-1/2 right-5 z-20 hidden size-11 -translate-y-1/2 rounded-full shadow-md backdrop-blur transition-transform active:scale-[0.95] xl:inline-flex"
                                        >
                                            <ChevronRight className="size-5" />
                                        </Button>
                                    </>
                                )}

                                <PdfPageCanvas
                                    document={pdfDocument}
                                    pageNumber={currentPage}
                                    zoom={zoom}
                                    fitMode={fitMode}
                                    surfaceTheme={surfaceTheme}
                                    containerWidth={effectiveCanvasWidth}
                                    containerHeight={stageMetrics.height}
                                />

                                {/* Desktop Edge Turn Controls */}
                                {pageCount > 1 && (
                                    <div className="mt-4 hidden items-center gap-3 pb-4 md:flex">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="bg-card/90 h-9 gap-1.5 rounded-xl backdrop-blur transition-transform active:scale-[0.96]"
                                            disabled={currentPage <= 1}
                                            onClick={() => goToPage(currentPage - 1)}
                                        >
                                            <ChevronLeft className="size-4" />
                                            Previous
                                        </Button>
                                        <span className="text-muted-foreground text-xs font-medium tabular-nums">
                                            Page {currentPage} of {pageCount}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="bg-card/90 h-9 gap-1.5 rounded-xl backdrop-blur transition-transform active:scale-[0.96]"
                                            disabled={currentPage >= pageCount}
                                            onClick={() => goToPage(currentPage + 1)}
                                        >
                                            Next
                                            <ChevronRight className="size-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {!loading && !error && pdfDocument && viewMode === "scroll" && (
                            <div className="flex w-full flex-col items-center gap-4 pb-10 sm:gap-6">
                                {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                                    <PdfPageCanvas
                                        key={pageNumber}
                                        document={pdfDocument}
                                        pageNumber={pageNumber}
                                        zoom={zoom}
                                        fitMode={fitMode}
                                        surfaceTheme={surfaceTheme}
                                        containerWidth={effectiveCanvasWidth}
                                        containerHeight={stageMetrics.height}
                                        lazy
                                        onBecomeVisible={handleVisibleScrollPage}
                                    />
                                ))}
                            </div>
                        )}
                    </main>
                </div>

                {/* Mobile Bottom Ergonomic Bar */}
                <nav
                    aria-label="Mobile reader controls"
                    className="border-border/80 bg-card/95 z-30 flex shrink-0 items-center justify-between gap-1 border-t px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
                >
                    {/* Contents / Pages / Search Sheet Trigger */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-xl"
                        onClick={() => setMobileSheetOpen(true)}
                        aria-label="Open pages, bookmarks, and search"
                    >
                        <List className="size-5" />
                    </Button>

                    {/* Prev / Scrubber / Next Group */}
                    <div className="bg-muted/60 flex items-center gap-0.5 rounded-2xl p-0.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 rounded-xl"
                            disabled={currentPage <= 1}
                            onClick={() => goToPage(currentPage - 1)}
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="size-5" />
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="hover:bg-background flex h-10 min-w-18 items-center justify-center rounded-xl px-2.5 text-xs font-semibold tabular-nums transition-colors"
                                    aria-label="Jump to page"
                                >
                                    {currentPage} / {pageCount || "—"}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="center" sideOffset={12} className="w-72 rounded-2xl p-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold">Jump to page</span>
                                        <span className="text-muted-foreground tabular-nums">
                                            {currentPage} of {pageCount || 1} ({progressPercent}%)
                                        </span>
                                    </div>
                                    <Slider
                                        min={1}
                                        max={Math.max(1, pageCount)}
                                        step={1}
                                        value={[currentPage]}
                                        onValueChange={(values) => {
                                            if (values[0]) goToPage(values[0]);
                                        }}
                                        aria-label="Page slider"
                                    />
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 rounded-xl"
                            disabled={currentPage >= pageCount}
                            onClick={() => goToPage(currentPage + 1)}
                            aria-label="Next page"
                        >
                            <ChevronRight className="size-5" />
                        </Button>
                    </div>

                    {/* Display Settings Popover (Zoom, Fit, Layout, Surface) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-11 rounded-xl"
                                aria-label="Reading display settings"
                            >
                                <SlidersHorizontal className="size-5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="end" sideOffset={12} className="w-72 space-y-4 rounded-2xl p-4">
                            <div className="space-y-2">
                                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                                    Reading layout
                                </p>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <Button
                                        type="button"
                                        variant={viewMode === "single" ? "default" : "outline"}
                                        size="sm"
                                        className="h-9 gap-1.5 rounded-xl text-xs"
                                        onClick={() => setViewMode("single")}
                                    >
                                        <FileText className="size-3.5" />
                                        Single page
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={viewMode === "scroll" ? "default" : "outline"}
                                        size="sm"
                                        className="h-9 gap-1.5 rounded-xl text-xs"
                                        onClick={() => setViewMode("scroll")}
                                    >
                                        <Rows3 className="size-3.5" />
                                        Scroll
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">Zoom</p>
                                    <span className="text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="size-9 rounded-xl"
                                        onClick={handleZoomOut}
                                        aria-label="Zoom out"
                                    >
                                        <Minus className="size-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={fitMode === "width" ? "secondary" : "outline"}
                                        size="sm"
                                        className="h-9 flex-1 rounded-xl text-xs"
                                        onClick={() => {
                                            setFitMode("width");
                                            setZoom(1);
                                        }}
                                    >
                                        Fit Width
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={fitMode === "page" ? "secondary" : "outline"}
                                        size="sm"
                                        className="h-9 flex-1 rounded-xl text-xs"
                                        onClick={() => {
                                            setFitMode("page");
                                            setZoom(1);
                                        }}
                                    >
                                        <Maximize2 className="mr-1 size-3" />
                                        Fit Page
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="size-9 rounded-xl"
                                        onClick={handleZoomIn}
                                        aria-label="Zoom in"
                                    >
                                        <Plus className="size-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                                    Paper surface
                                </p>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {(["paper", "sepia", "dark"] as ReaderSurfaceTheme[]).map((theme) => (
                                        <button
                                            key={theme}
                                            type="button"
                                            onClick={() => setSurfaceTheme(theme)}
                                            className={cn(
                                                "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
                                                surfaceTheme === theme
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border/70 hover:bg-muted",
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "size-5 rounded-full ring-1 ring-black/15",
                                                    theme === "paper" && "bg-white",
                                                    theme === "sepia" && "bg-[#f3ead8]",
                                                    theme === "dark" && "bg-zinc-900 ring-white/25",
                                                )}
                                            />
                                            {SURFACE_STYLES[theme].label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Bookmark Toggle */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-xl"
                        onClick={() => void toggleBookmark()}
                        aria-label={isCurrentBookmarked ? "Remove page bookmark" : "Bookmark page"}
                    >
                        <Bookmark className={cn("size-5", isCurrentBookmarked && "fill-amber-500 text-amber-600")} />
                    </Button>
                </nav>
            </div>

            {/* Mobile Sidebar Sheet */}
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
                <SheetContent side="left" className="flex w-[86vw] max-w-xs flex-col p-0">
                    <SheetHeader className="border-border/70 border-b px-4 py-3 text-left">
                        <SheetTitle className="truncate font-serif text-base">{book.title}</SheetTitle>
                        <SheetDescription className="text-xs">
                            Browse pages, jump to saved bookmarks, or search text inside this eBook.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-hidden">{sidebarElement}</div>
                </SheetContent>
            </Sheet>

            {/* Account Gate Dialog for Guest Downloads / Cloud Sync */}
            <AccountGateDialog
                open={gateDialogOpen}
                onOpenChange={setGateDialogOpen}
                reason={gateReason}
                bookTitle={book.title}
                fileSizeLabel={formatBytes(book.file_size_bytes)}
                signInUrl={reader.authenticate_url}
                signUpUrl={reader.signup_url}
            />
        </>
    );
}

function formatBytes(bytes?: number | null): string | null {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
