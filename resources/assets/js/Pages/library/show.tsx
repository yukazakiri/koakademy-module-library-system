import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { IconTile } from "@/components/reui/icon-tile";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { index as libraryIndex } from "@/routes/library";
import { download, favorite, read, unfavorite } from "@/routes/library/books";
import type { User } from "@/types/user";
import { Head, Link, router } from "@inertiajs/react";
import {
    ArrowLeft,
    BookOpen,
    Building2,
    Calendar,
    CheckCircle2,
    ChevronRight,
    Download,
    FileText,
    Globe2,
    Heart,
    LibraryBig,
    Lock,
    Mail,
    MapPin,
    Scale,
    ShieldCheck,
    UserRound,
    X,
} from "lucide-react";
import React, { useState } from "react";
import { AccountGateDialog, type AccountGateReason } from "./components/account-gate-dialog";
import { BookCard, type LibraryBookCardData } from "./components/book-card";
import { BookCover } from "./components/book-cover";
import { LibraryShell } from "./components/library-shell";

interface BookDetail {
    id: number;
    title: string;
    isbn: string | null;
    call_number: string | null;
    accession_number: string | null;
    author: string | null;
    author_biography: string | null;
    category: string | null;
    category_color: string | null;
    publisher: string | null;
    publication_year: number | null;
    pages: number | null;
    description: string | null;
    location: string | null;
    cover_image_url: string | null;
    available_online: boolean;
    downloads_allowed: boolean;
    file_size_bytes: number | null;
    rights_basis: string | null;
    rights_holder: string | null;
    license_url: string | null;
    rights_expires_at: string | null;
}

interface AccessProps {
    is_authenticated: boolean;
    can_download: boolean;
    download_requires_auth: boolean;
    authenticate_url: string;
    login_url: string;
    signup_url: string;
    ready_action: "download" | null;
}

interface Props {
    auth?: { user?: User | null };
    book: BookDetail;
    state: {
        is_favorite: boolean;
        last_page: number | null;
        total_pages: number | null;
        last_read_at: string | null;
    };
    related: LibraryBookCardData[];
    takedown_email: string | null;
    access?: AccessProps;
}

const RIGHTS_LABELS: Record<string, string> = {
    koakademy_owned: "KoAkademy-owned work",
    written_permission: "Written permission",
    licensed: "Licensed distribution",
    open_license: "Open educational license",
    public_domain: "Public domain",
};

function formatFileSize(bytes?: number | null): string | null {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DigitalLibraryShow({ auth, book, state, related, takedown_email, access }: Props) {
    const user = auth?.user ?? null;
    const isAuthenticated = Boolean(user);
    const canDownload = access?.can_download ?? (isAuthenticated && book.available_online && book.downloads_allowed);
    const downloadRequiresAuth = access?.download_requires_auth ?? (!isAuthenticated && book.available_online && book.downloads_allowed);
    const loginUrl = access?.login_url ?? "/login";
    const signupUrl = access?.signup_url ?? "/signup";
    const authenticateUrl = access?.authenticate_url ?? loginUrl;

    const [isFavorite, setIsFavorite] = useState(state.is_favorite);
    const [favoritePending, setFavoritePending] = useState(false);
    const [gateOpen, setGateOpen] = useState(false);
    const [gateReason, setGateReason] = useState<AccountGateReason>("download");
    const [dismissedReadyBanner, setDismissedReadyBanner] = useState(false);

    const fileSizeLabel = formatFileSize(book.file_size_bytes);
    const progress = state.last_page && state.total_pages ? Math.min(100, Math.round((state.last_page / state.total_pages) * 100)) : null;

    const openGate = (reason: AccountGateReason) => {
        setGateReason(reason);
        setGateOpen(true);
    };

    const toggleFavorite = () => {
        if (!isAuthenticated) {
            openGate("favorite");
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
            only: ["state"],
            onError: () => setIsFavorite(!next),
            onFinish: () => setFavoritePending(false),
        });
    };

    return (
        <LibraryShell
            user={user}
            loginUrl={loginUrl}
            signupUrl={signupUrl}
            bottomInsetClassName={book.available_online ? "pb-24 md:pb-8" : undefined}
        >
            <Head title={`${book.title} • Digital Library`} />

            <div className="flex flex-col gap-5 sm:gap-6">
                {/* ── Post-Login Ready to Download Callout ── */}
                {access?.ready_action === "download" && canDownload && !dismissedReadyBanner && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
                        <div className="flex items-center gap-2.5">
                            <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <p className="text-foreground text-xs font-medium sm:text-sm">
                                Signed in! Your PDF copy is unlocked and ready to download.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <a
                                href={download.url(book.id)}
                                className={cn(
                                    buttonVariants({ size: "sm" }),
                                    "h-9 gap-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700",
                                )}
                            >
                                <Download className="size-3.5" />
                                Download PDF{fileSizeLabel ? ` (${fileSizeLabel})` : ""}
                            </a>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setDismissedReadyBanner(true)}
                                aria-label="Dismiss download notice"
                            >
                                <X className="size-4" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── Breadcrumb & Back Navigation ── */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <nav aria-label="Breadcrumb" className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                        <Link
                            href={libraryIndex.url()}
                            className="hover:text-foreground inline-flex shrink-0 items-center gap-1 font-medium transition-colors"
                        >
                            <ArrowLeft className="size-3.5" />
                            Digital Library
                        </Link>
                        <ChevronRight className="text-muted-foreground/50 size-3 shrink-0" />
                        {book.category && (
                            <>
                                <span className="hidden truncate sm:inline">{book.category}</span>
                                <ChevronRight className="text-muted-foreground/50 hidden size-3 shrink-0 sm:inline" />
                            </>
                        )}
                        <span className="text-foreground truncate font-semibold">{book.title}</span>
                    </nav>

                    <Link
                        href={libraryIndex.url()}
                        className={cn(buttonVariants({ variant: "outline", size: "xs" }), "hidden gap-1.5 rounded-lg font-medium sm:inline-flex")}
                    >
                        <ArrowLeft className="size-3" />
                        Back to Catalog
                    </Link>
                </div>

                {/* ── Hero Book Showcase ── */}
                <Frame variant="default" spacing="sm" className="border-border/80 bg-card/70 overflow-hidden shadow-xs">
                    <FramePanel className="via-background relative overflow-hidden bg-linear-to-br from-amber-500/8 to-sky-500/8 p-4 sm:p-6 md:p-7">
                        <div className="relative z-10 grid gap-5 lg:grid-cols-[16rem_1fr] lg:items-center lg:gap-10">
                            {/* Book Cover */}
                            <div className="mx-auto aspect-3/4 w-full max-w-[10.5rem] overflow-hidden rounded-xl shadow-xl sm:max-w-[14.5rem] lg:max-w-none">
                                <BookCover title={book.title} author={book.author} coverUrl={book.cover_image_url} priority />
                            </div>

                            {/* Metadata & Primary Actions */}
                            <div className="flex flex-col justify-center gap-4 sm:gap-5">
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                        {book.category && (
                                            <Badge
                                                variant="outline"
                                                radius="full"
                                                size="sm"
                                                className="text-muted-foreground bg-background/85 font-semibold tracking-wider uppercase"
                                            >
                                                {book.category}
                                            </Badge>
                                        )}
                                        {book.available_online ? (
                                            <Badge variant="success-light" radius="full" size="sm" className="font-semibold tracking-wide">
                                                <Globe2 className="mr-1 size-3" />
                                                Free to Read Online
                                            </Badge>
                                        ) : (
                                            <Badge variant="invert-light" radius="full" size="sm" className="font-medium tracking-wide">
                                                <LibraryBig className="text-muted-foreground mr-1 size-3" />
                                                Physical Copy Only
                                            </Badge>
                                        )}
                                        {book.available_online && book.downloads_allowed && (
                                            <Badge variant="outline" radius="full" size="sm" className="bg-background/85 text-muted-foreground font-medium">
                                                {isAuthenticated ? (
                                                    <>
                                                        <Download className="mr-1 size-3 text-emerald-600 dark:text-emerald-400" />
                                                        PDF Download Enabled{fileSizeLabel ? ` · ${fileSizeLabel}` : ""}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Lock className="mr-1 size-3" />
                                                        Download with Account{fileSizeLabel ? ` · ${fileSizeLabel}` : ""}
                                                    </>
                                                )}
                                            </Badge>
                                        )}
                                        {book.publication_year && (
                                            <Badge
                                                variant="outline"
                                                radius="full"
                                                size="sm"
                                                className="text-muted-foreground bg-background/85 font-medium tabular-nums"
                                            >
                                                {book.publication_year}
                                            </Badge>
                                        )}
                                    </div>

                                    <div>
                                        <h1 className="text-foreground font-serif text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl md:text-4xl">
                                            {book.title}
                                        </h1>
                                        <p className="text-muted-foreground mt-1.5 text-sm sm:text-base md:text-lg">
                                            {book.author ? `By ${book.author}` : "Author unrecorded in catalog"}
                                        </p>
                                    </div>

                                    <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed text-pretty">
                                        {book.description || "No catalog synopsis or abstract is recorded for this volume."}
                                    </p>
                                </div>

                                {/* Reading Progress Meter (Signed-in users) */}
                                {progress !== null && book.available_online && (
                                    <div className="border-border/60 bg-background/80 max-w-md space-y-2 rounded-xl border p-3 shadow-2xs">
                                        <div className="text-muted-foreground flex justify-between text-xs font-semibold tracking-wider uppercase">
                                            <span>Your Reading Progress</span>
                                            <span className="text-foreground font-mono tabular-nums">
                                                {progress}% (Page {state.last_page ?? 1} of {state.total_pages})
                                            </span>
                                        </div>
                                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                                            <div
                                                className="bg-primary h-full rounded-full transition-[width] duration-300 ease-out"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons Deck (Primary read/download live in sticky mobile bar on < md for online books) */}
                                <div className="flex flex-wrap items-center gap-2.5 pt-1 sm:gap-3">
                                    {book.available_online ? (
                                        <Link
                                            href={read.url(book.id)}
                                            className={cn(
                                                buttonVariants({ size: "default" }),
                                                "hidden h-11 gap-2 rounded-xl px-5 font-semibold shadow-xs transition-transform active:scale-[0.96] md:inline-flex",
                                            )}
                                        >
                                            <BookOpen className="size-4" />
                                            {state.last_page && state.last_page > 1
                                                ? `Continue Reading (Page ${state.last_page})`
                                                : "Read Online Free"}
                                        </Link>
                                    ) : (
                                        <Button size="default" disabled className="h-11 gap-2 rounded-xl px-5">
                                            <LibraryBig className="size-4" />
                                            Physical Archive Only
                                        </Button>
                                    )}

                                    {canDownload && (
                                        <a
                                            href={download.url(book.id)}
                                            className={cn(
                                                buttonVariants({ variant: "outline", size: "default" }),
                                                "hidden h-11 gap-2 rounded-xl px-4 font-semibold shadow-2xs transition-transform active:scale-[0.96] md:inline-flex",
                                            )}
                                        >
                                            <Download className="size-4" />
                                            <span>Download PDF{fileSizeLabel ? ` (${fileSizeLabel})` : ""}</span>
                                        </a>
                                    )}

                                    {downloadRequiresAuth && (
                                        <Button
                                            type="button"
                                            size="default"
                                            variant="outline"
                                            onClick={() => openGate("download")}
                                            className="hidden h-11 gap-2 rounded-xl px-4 font-semibold shadow-2xs transition-transform active:scale-[0.96] md:inline-flex"
                                        >
                                            <Download className="size-4" />
                                            <span>Download PDF</span>
                                            <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                                <Lock className="size-2.5" />
                                                Account
                                            </span>
                                        </Button>
                                    )}

                                    <Button
                                        size="default"
                                        variant="outline"
                                        className="h-11 gap-2 rounded-xl px-4 shadow-2xs transition-transform active:scale-[0.96]"
                                        onClick={toggleFavorite}
                                        disabled={favoritePending}
                                        aria-label={isFavorite ? "Remove from saved shelf" : "Save to my shelf"}
                                        aria-pressed={isFavorite}
                                    >
                                        <Heart className={cn("size-4", isFavorite && "fill-rose-500 text-rose-500")} />
                                        <span>{isFavorite ? "Saved" : "Save"}</span>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </FramePanel>
                </Frame>

                {/* ── Archival Details & Rights Grid ── */}
                <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] lg:gap-6">
                    <div className="space-y-5">
                        <Frame variant="default" spacing="sm" className="border-border/80 bg-card/70 shadow-xs">
                            <FramePanel className="space-y-4 p-5">
                                <div className="flex items-center gap-2.5">
                                    <IconTile variant="soft" size="sm" className="text-primary">
                                        <LibraryBig />
                                    </IconTile>
                                    <div>
                                        <h2 className="text-foreground font-serif text-lg font-semibold">Catalog Details</h2>
                                        <p className="text-muted-foreground text-xs">Bibliographic metadata and physical shelf record.</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-1 xl:grid-cols-3">
                                    <DetailTile icon={UserRound} label="Author" value={book.author} />
                                    <DetailTile icon={Building2} label="Publisher" value={book.publisher} />
                                    <DetailTile icon={Calendar} label="Published" value={book.publication_year?.toString()} />
                                    <DetailTile icon={FileText} label="Length" value={book.pages ? `${book.pages} pages` : null} />
                                    <DetailTile icon={MapPin} label="Shelf Location" value={book.location} />
                                    <DetailTile icon={LibraryBig} label="Call Number" value={book.call_number} />
                                    <DetailTile icon={ShieldCheck} label="Accession No." value={book.accession_number} />
                                    <DetailTile icon={BookOpen} label="ISBN" value={book.isbn} />
                                </div>
                            </FramePanel>
                        </Frame>

                        {book.author_biography && (
                            <Frame variant="default" spacing="sm" className="border-border/80 bg-card/70 shadow-xs">
                                <FramePanel className="space-y-3 p-5">
                                    <div className="flex items-center gap-2.5">
                                        <IconTile variant="soft" size="sm" className="text-sky-600 dark:text-sky-400">
                                            <UserRound />
                                        </IconTile>
                                        <h2 className="text-foreground font-serif text-lg font-semibold">About {book.author}</h2>
                                    </div>
                                    <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{book.author_biography}</p>
                                </FramePanel>
                            </Frame>
                        )}
                    </div>

                    {/* Access & Digital Rights Rail */}
                    <div className="space-y-5">
                        <Frame variant="default" spacing="sm" className="border-border/80 bg-card/70 shadow-xs">
                            <FramePanel className="space-y-4 p-5">
                                <div className="flex items-center gap-2.5">
                                    <IconTile variant="soft" size="sm" className="text-amber-600 dark:text-amber-400">
                                        <Scale />
                                    </IconTile>
                                    <div>
                                        <h2 className="text-foreground font-serif text-base font-semibold">Access & Licensing</h2>
                                        <p className="text-muted-foreground text-[11px]">Digital reading and download permissions</p>
                                    </div>
                                </div>

                                <div className="text-muted-foreground space-y-3 text-xs leading-relaxed">
                                    {book.available_online ? (
                                        <>
                                            <div className="border-border/70 bg-background/70 space-y-2.5 rounded-xl border p-3.5">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-foreground font-semibold">Online Reading</span>
                                                    <Badge variant="success-light" size="xs" radius="full">
                                                        Open to Everyone
                                                    </Badge>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-foreground font-semibold">PDF Download</span>
                                                    <Badge variant={book.downloads_allowed ? "primary-light" : "outline"} size="xs" radius="full">
                                                        {book.downloads_allowed ? "Account Required" : "View-Only License"}
                                                    </Badge>
                                                </div>
                                                <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                                                    <span className="text-foreground font-semibold">Rights Basis</span>
                                                    <span className="text-foreground font-medium">
                                                        {book.rights_basis
                                                            ? (RIGHTS_LABELS[book.rights_basis] ?? book.rights_basis)
                                                            : "Documented permission"}
                                                    </span>
                                                </div>
                                                {book.rights_holder && (
                                                    <p>
                                                        <span className="text-foreground font-medium">Rights Holder:</span> {book.rights_holder}
                                                    </p>
                                                )}
                                                {book.license_url && (
                                                    <a
                                                        href={book.license_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-primary hover:text-primary/80 inline-block font-medium underline underline-offset-4"
                                                    >
                                                        View license terms
                                                    </a>
                                                )}
                                            </div>

                                            <p className="text-muted-foreground/90 text-[11px] leading-relaxed">
                                                {book.downloads_allowed
                                                    ? "Anyone may read this digital edition online. Signed-in users may download a personal PDF copy for non-commercial study."
                                                    : "This digital edition is cleared for online browser reading only; local PDF downloads are disabled by its license."}
                                            </p>
                                        </>
                                    ) : (
                                        <div className="border-border/70 bg-muted/30 rounded-xl border p-3.5 text-center">
                                            <p>No digital PDF edition is published for this title yet.</p>
                                            <p className="text-muted-foreground mt-1 text-[11px]">
                                                Visit the physical library circulation desk to borrow this volume.
                                            </p>
                                        </div>
                                    )}

                                    {takedown_email && (
                                        <div className="border-border/60 text-muted-foreground border-t pt-3 text-[11px]">
                                            <span className="flex items-center gap-1.5">
                                                <Mail className="text-muted-foreground size-3" />
                                                <span>Rights inquiries or takedown requests:</span>
                                            </span>
                                            <a
                                                href={`mailto:${takedown_email}`}
                                                className="text-primary hover:text-primary/80 mt-0.5 ml-4 inline-block font-medium underline underline-offset-2"
                                            >
                                                {takedown_email}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </FramePanel>
                        </Frame>
                    </div>
                </div>

                {/* ── Related Books ── */}
                {related.length > 0 && (
                    <section aria-labelledby="related-heading" className="border-border/60 space-y-4 border-t pt-5">
                        <div className="space-y-1">
                            <p className="text-primary text-[11px] font-semibold tracking-wider uppercase">Same Discipline</p>
                            <h2 id="related-heading" className="text-foreground font-serif text-xl font-semibold sm:text-2xl">
                                Related Works
                            </h2>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                            {related.map((relatedBook) => (
                                <BookCard
                                    key={relatedBook.id}
                                    book={relatedBook}
                                    isAuthenticated={isAuthenticated}
                                    onRequireAuth={() => openGate("favorite")}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* ── Mobile Sticky Bottom Action Bar ── */}
            {book.available_online && (
                <div className="border-border/80 bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden">
                    <div className="mx-auto flex max-w-lg items-center gap-2.5">
                        <Link
                            href={read.url(book.id)}
                            className={cn(
                                buttonVariants({ size: "default" }),
                                "h-11 flex-1 gap-2 rounded-xl font-semibold shadow-xs transition-transform active:scale-[0.96]",
                            )}
                        >
                            <BookOpen className="size-4" />
                            {state.last_page && state.last_page > 1 ? `Resume · Page ${state.last_page}` : "Read Online Free"}
                        </Link>

                        {canDownload && (
                            <a
                                href={download.url(book.id)}
                                className={cn(
                                    buttonVariants({ variant: "outline", size: "icon" }),
                                    "size-11 shrink-0 rounded-xl transition-transform active:scale-[0.96]",
                                )}
                                aria-label="Download PDF"
                            >
                                <Download className="size-4.5" />
                            </a>
                        )}

                        {downloadRequiresAuth && (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => openGate("download")}
                                className="relative size-11 shrink-0 rounded-xl transition-transform active:scale-[0.96]"
                                aria-label="Sign in to download PDF"
                            >
                                <Download className="size-4.5" />
                                <Lock className="bg-background ring-border absolute right-1.5 bottom-1.5 size-3 rounded-full p-0.5 ring-1" />
                            </Button>
                        )}
                    </div>
                </div>
            )}

            <AccountGateDialog
                open={gateOpen}
                onOpenChange={setGateOpen}
                reason={gateReason}
                bookTitle={book.title}
                fileSizeLabel={fileSizeLabel}
                signInUrl={gateReason === "download" ? authenticateUrl : loginUrl}
                signUpUrl={signupUrl}
            />
        </LibraryShell>
    );
}

function DetailTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string | null }) {
    return (
        <div className="border-border/60 bg-background/65 flex items-start gap-2.5 rounded-xl border p-2.5 sm:p-3">
            <IconTile variant="soft" size="xs" className="text-muted-foreground mt-0.5 shrink-0">
                <Icon className="size-3.5" />
            </IconTile>
            <div className="min-w-0">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{label}</p>
                <p className="text-foreground mt-0.5 text-xs font-medium wrap-break-word tabular-nums">{value || "—"}</p>
            </div>
        </div>
    );
}
