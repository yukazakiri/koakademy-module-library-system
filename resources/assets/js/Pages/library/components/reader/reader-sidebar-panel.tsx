import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Bookmark, LoaderCircle, Search, Trash2 } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { ReaderBookmark } from "./use-guest-reading-state";

interface ReaderSidebarPanelProps {
    document: PDFDocumentProxy | null;
    pageCount: number;
    currentPage: number;
    activeTab: "pages" | "bookmarks" | "search";
    onTabChange: (tab: "pages" | "bookmarks" | "search") => void;
    bookmarks: ReaderBookmark[];
    isGuest: boolean;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    searching: boolean;
    searchResults: number[];
    onSearchSubmit: () => void;
    onSelectPage: (pageNumber: number) => void;
    onRemoveBookmark: (bookmark: ReaderBookmark) => void;
    onPromptSync?: () => void;
}

export function ReaderSidebarPanel({
    document,
    pageCount,
    currentPage,
    activeTab,
    onTabChange,
    bookmarks,
    isGuest,
    searchQuery,
    onSearchQueryChange,
    searching,
    searchResults,
    onSearchSubmit,
    onSelectPage,
    onRemoveBookmark,
    onPromptSync,
}: ReaderSidebarPanelProps) {
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (activeTab === "search") {
            const timer = window.setTimeout(() => searchInputRef.current?.focus(), 60);
            return () => window.clearTimeout(timer);
        }
    }, [activeTab]);

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => onTabChange(value as "pages" | "bookmarks" | "search")}
            className="flex h-full min-h-0 flex-col"
        >
            <div className="border-border/70 border-b px-3 py-2.5">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="pages" className="text-xs">
                        Pages
                    </TabsTrigger>
                    <TabsTrigger value="bookmarks" className="text-xs">
                        Saved ({bookmarks.length})
                    </TabsTrigger>
                    <TabsTrigger value="search" className="text-xs">
                        Search
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="pages" className="mt-0 min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full px-3 py-3">
                    <div className="grid grid-cols-2 gap-2.5 pb-6">
                        {document &&
                            Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                                <PdfThumbnail
                                    key={pageNumber}
                                    document={document}
                                    pageNumber={pageNumber}
                                    active={pageNumber === currentPage}
                                    onSelect={onSelectPage}
                                />
                            ))}
                    </div>
                </ScrollArea>
            </TabsContent>

            <TabsContent value="bookmarks" className="mt-0 min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full px-3 py-3">
                    <div className="space-y-2 pb-6">
                        {isGuest && (
                            <div className="bg-muted/50 border-border/70 mb-3 rounded-xl border p-3 text-xs leading-relaxed">
                                <p className="text-muted-foreground">
                                    Bookmarks are stored on this device while reading as a guest.
                                </p>
                                {onPromptSync && (
                                    <button
                                        type="button"
                                        onClick={onPromptSync}
                                        className="text-primary mt-1.5 font-semibold underline-offset-4 hover:underline"
                                    >
                                        Sign in to sync across devices
                                    </button>
                                )}
                            </div>
                        )}

                        {bookmarks.length > 0 ? (
                            bookmarks.map((bookmark) => (
                                <div
                                    key={bookmark.id}
                                    className={cn(
                                        "border-border/70 hover:bg-muted/60 flex items-center gap-2 rounded-xl border p-2 transition-colors",
                                        bookmark.page === currentPage && "border-primary/50 bg-primary/5",
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSelectPage(bookmark.page)}
                                        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 px-1.5 text-left"
                                    >
                                        <Bookmark className="size-4 shrink-0 fill-amber-500 text-amber-600" />
                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-semibold">
                                                {bookmark.label || `Page ${bookmark.page}`}
                                            </p>
                                            <p className="text-muted-foreground text-[11px] tabular-nums">Page {bookmark.page}</p>
                                        </div>
                                    </button>
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        className="text-muted-foreground hover:text-destructive size-8 shrink-0 rounded-lg"
                                        onClick={() => onRemoveBookmark(bookmark)}
                                        aria-label={`Remove bookmark on page ${bookmark.page}`}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            ))
                        ) : (
                            <EmptySidebar message="Tap the bookmark icon while reading to mark pages for quick return." />
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>

            <TabsContent value="search" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-3">
                <form
                    className="flex shrink-0 gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onSearchSubmit();
                    }}
                >
                    <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                        placeholder="Search inside this eBook…"
                        aria-label="Search PDF text"
                        className="h-10 text-sm"
                    />
                    <Button type="submit" size="icon" className="size-10 shrink-0" disabled={searching} aria-label="Search">
                        {searching ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                    </Button>
                </form>

                <ScrollArea className="mt-3 min-h-0 flex-1">
                    <div className="space-y-2 pb-6">
                        {searchResults.map((pageNumber) => (
                            <button
                                key={pageNumber}
                                type="button"
                                onClick={() => onSelectPage(pageNumber)}
                                className={cn(
                                    "border-border/70 hover:bg-muted flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors",
                                    pageNumber === currentPage && "border-primary/50 bg-primary/5",
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    <Search className="text-muted-foreground size-3.5" />
                                    Match found
                                </span>
                                <span className="bg-muted rounded-md px-2 py-0.5 font-semibold tabular-nums">
                                    Page {pageNumber}
                                </span>
                            </button>
                        ))}
                        {!searching && searchQuery.trim() !== "" && searchResults.length === 0 && (
                            <EmptySidebar message="No matching pages found. Try a shorter keyword or check spelling." />
                        )}
                        {!searching && searchQuery.trim() === "" && (
                            <EmptySidebar message="Enter a phrase or term and press Enter to search across every page." />
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>
        </Tabs>
    );
}

function PdfThumbnail({
    document,
    pageNumber,
    active,
    onSelect,
}: {
    document: PDFDocumentProxy;
    pageNumber: number;
    active: boolean;
    onSelect: (page: number) => void;
}) {
    const wrapperRef = useRef<HTMLButtonElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!wrapperRef.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "200px 0px" },
        );
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible || !canvasRef.current) return;
        let task: RenderTask | null = null;
        let cancelled = false;

        void document.getPage(pageNumber).then(async (page: PDFPageProxy) => {
            if (cancelled || !canvasRef.current) return;
            const viewport = page.getViewport({ scale: 0.22 });
            const canvas = canvasRef.current;
            const context = canvas.getContext("2d");
            if (!context) return;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            task = page.render({ canvas, canvasContext: context, viewport });
            try {
                await task.promise;
            } catch (renderError) {
                if ((renderError as Error).name !== "RenderingCancelledException") throw renderError;
            }
        });

        return () => {
            cancelled = true;
            task?.cancel();
        };
    }, [document, pageNumber, visible]);

    return (
        <button
            ref={wrapperRef}
            type="button"
            onClick={() => onSelect(pageNumber)}
            className={cn(
                "border-border/75 hover:border-primary/50 flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                active && "border-primary bg-primary/5 ring-primary/20 ring-2",
            )}
            aria-label={`Go to page ${pageNumber}`}
            aria-current={active ? "page" : undefined}
        >
            <div className="bg-muted flex aspect-3/4 w-full items-center justify-center overflow-hidden rounded-md ring-1 ring-black/10 dark:ring-white/10">
                {visible ? (
                    <canvas ref={canvasRef} className="max-h-full max-w-full bg-white" />
                ) : (
                    <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
                )}
            </div>
            <span className={cn("text-xs tabular-nums", active ? "text-primary font-semibold" : "text-muted-foreground")}>
                {pageNumber}
            </span>
        </button>
    );
}

function EmptySidebar({ message }: { message: string }) {
    return (
        <p className="text-muted-foreground border-border/80 rounded-xl border border-dashed p-4 text-center text-xs leading-relaxed">
            {message}
        </p>
    );
}
