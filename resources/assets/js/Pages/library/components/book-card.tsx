import { Badge } from "@/components/reui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { favorite, read, show, unfavorite } from "@/routes/library/books";
import { Link, router } from "@inertiajs/react";
import { BookOpen, Bookmark, Heart, LibraryBig, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { BookCover } from "./book-cover";

export interface LibraryBookCardData {
    id: number;
    title: string;
    author: string | null;
    category: string | null;
    category_color: string | null;
    publication_year: number | null;
    description: string;
    cover_image_url: string | null;
    available_online: boolean;
    visibility?: "public" | "authenticated" | "members_only" | null;
    requires_account_to_read?: boolean;
    downloads_allowed?: boolean;
    file_size_bytes?: number | null;
    is_favorite: boolean;
}

interface BookCardProps {
    book: LibraryBookCardData;
    priority?: boolean;
    isAuthenticated?: boolean;
    onRequireAuth?: (book: LibraryBookCardData, reason?: "favorite" | "read") => void;
}

export function BookCard({ book, priority = false, isAuthenticated = true, onRequireAuth }: BookCardProps) {
    const [isFavorite, setIsFavorite] = useState(book.is_favorite);
    const [favoritePending, setFavoritePending] = useState(false);

    useEffect(() => setIsFavorite(book.is_favorite), [book.is_favorite]);

    const readRequiresAuth = Boolean(book.available_online && book.requires_account_to_read && !isAuthenticated);

    const toggleFavorite = () => {
        if (!isAuthenticated) {
            onRequireAuth?.(book, "favorite");
            return;
        }

        const next = !isFavorite;
        setIsFavorite(next);
        setFavoritePending(true);

        const routeDefinition = next ? favorite(book.id) : unfavorite(book.id);
        router.visit(routeDefinition.url, {
            method: routeDefinition.method,
            preserveScroll: true,
            preserveState: true,
            only: ["books", "stats", "state"],
            onError: () => setIsFavorite(!next),
            onFinish: () => setFavoritePending(false),
        });
    };

    return (
        <article className="group border-border/75 bg-card/95 hover:border-primary/35 relative flex min-h-full flex-col overflow-hidden rounded-2xl border shadow-2xs transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md">
            <Link href={show.url(book.id)} prefetch className="relative block aspect-3/4 overflow-hidden">
                <BookCover title={book.title} author={book.author} coverUrl={book.cover_image_url} priority={priority} />
                <div className="pointer-events-none absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
                    {book.available_online ? (
                        readRequiresAuth ? (
                            <Badge
                                variant="invert-light"
                                radius="full"
                                size="xs"
                                className="border border-amber-400/40 bg-slate-950/85 font-semibold tracking-wide text-amber-100 shadow-xs backdrop-blur-md"
                            >
                                <Lock className="mr-1 size-3 text-amber-300" />
                                Sign in to Read
                            </Badge>
                        ) : (
                            <Badge
                                variant="success-light"
                                radius="full"
                                size="xs"
                                className="border border-emerald-400/35 bg-emerald-950/85 font-semibold tracking-wide text-emerald-100 shadow-xs backdrop-blur-md"
                            >
                                <BookOpen className="mr-1 size-3 text-emerald-300" />
                                Read Online
                            </Badge>
                        )
                    ) : (
                        <Badge
                            variant="invert-light"
                            radius="full"
                            size="xs"
                            className="border border-white/20 bg-black/65 font-medium tracking-wide text-white/90 shadow-xs backdrop-blur-md"
                        >
                            <LibraryBig className="mr-1 size-3 text-white/75" />
                            In Library
                        </Badge>
                    )}
                </div>
            </Link>

            <div className="flex flex-1 flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {book.category && (
                            <span className="text-muted-foreground max-w-full truncate font-semibold tracking-wider uppercase">
                                {book.category}
                            </span>
                        )}
                        {book.publication_year && (
                            <span className="text-muted-foreground/75 font-medium tabular-nums">
                                {book.category ? `· ${book.publication_year}` : book.publication_year}
                            </span>
                        )}
                    </div>
                    <div>
                        <Link href={show.url(book.id)} prefetch className="hover:text-primary transition-colors">
                            <h3 className="line-clamp-2 font-serif text-sm leading-snug font-semibold text-balance sm:text-base">
                                {book.title}
                            </h3>
                        </Link>
                        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{book.author || "Unknown author"}</p>
                    </div>
                    <p className="text-muted-foreground hidden line-clamp-2 text-xs leading-relaxed text-pretty sm:block">
                        {book.description || "No description available in catalogue records."}
                    </p>
                </div>

                <div className="mt-auto flex items-center gap-1.5 pt-1 sm:gap-2 sm:pt-2">
                    {readRequiresAuth ? (
                        <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => onRequireAuth?.(book, "read")}
                            className="h-9 flex-1 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs transition-transform active:scale-[0.96]"
                        >
                            <Lock className="size-3.5 shrink-0" />
                            <span className="truncate">Sign in to Read</span>
                        </Button>
                    ) : (
                        <Link
                            href={book.available_online ? read.url(book.id) : show.url(book.id)}
                            prefetch
                            className={cn(
                                buttonVariants({ variant: book.available_online ? "default" : "outline", size: "sm" }),
                                "h-9 flex-1 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs transition-transform active:scale-[0.96]",
                            )}
                        >
                            {book.available_online ? <BookOpen className="size-3.5 shrink-0" /> : <Bookmark className="size-3.5 shrink-0" />}
                            <span className="truncate">{book.available_online ? "Read Now" : "Details"}</span>
                        </Link>
                    )}

                    <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="size-9 shrink-0 rounded-lg transition-transform active:scale-[0.96]"
                        onClick={toggleFavorite}
                        disabled={favoritePending}
                        aria-label={
                            !isAuthenticated
                                ? `Sign in to save ${book.title}`
                                : isFavorite
                                  ? `Remove ${book.title} from favorites`
                                  : `Add ${book.title} to favorites`
                        }
                        aria-pressed={isFavorite}
                    >
                        <Heart className={cn("size-3.5", isFavorite && "fill-rose-500 text-rose-500")} />
                    </Button>
                </div>
            </div>
        </article>
    );
}
