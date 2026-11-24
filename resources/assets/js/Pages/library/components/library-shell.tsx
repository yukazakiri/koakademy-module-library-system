import { AnalyticsScripts } from "@/components/analytics-scripts";
import PortalLayout from "@/components/portal-layout";
import { SeoHead } from "@/components/seo-head";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { buttonVariants } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { index as libraryIndex } from "@/routes/library";
import type { User } from "@/types/user";
import { Link, usePage } from "@inertiajs/react";
import { BookOpen, LibraryBig, LogIn, UserPlus } from "lucide-react";
import type { ReactNode } from "react";

interface LibraryShellProps {
    user: User | null | undefined;
    loginUrl?: string;
    signupUrl?: string;
    children: ReactNode;
    bottomInsetClassName?: string;
}

export function LibraryShell({
    user,
    loginUrl = "/login",
    signupUrl = "/signup",
    children,
    bottomInsetClassName,
}: LibraryShellProps) {
    const branding = useBranding();
    const { url } = usePage();

    if (user) {
        return <PortalLayout user={user}>{children}</PortalLayout>;
    }

    const isEbooksTab = url.includes("availability=online");

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col antialiased">
            <SeoHead />
            <AnalyticsScripts />

            <header className="border-border/70 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-xl">
                <div className="mx-auto flex h-15 w-full max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
                    <div className="flex min-w-0 items-center gap-5">
                        <Link
                            href={libraryIndex.url()}
                            className="group flex min-w-0 items-center gap-2.5 rounded-lg py-1 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <div className="bg-primary/10 text-primary ring-primary/15 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1">
                                <LibraryBig className="size-4.5" />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate font-serif text-sm font-semibold tracking-tight sm:text-base">
                                    {branding.appName}
                                </p>
                                <p className="text-muted-foreground hidden text-[11px] leading-none sm:block">
                                    Open Digital Library
                                </p>
                            </div>
                        </Link>

                        <nav aria-label="Digital Library navigation" className="hidden items-center gap-1 md:flex">
                            <Link
                                href={libraryIndex.url()}
                                className={cn(
                                    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
                                    !isEbooksTab
                                        ? "bg-muted text-foreground font-semibold"
                                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                )}
                            >
                                <LibraryBig className="size-3.5" />
                                All Catalog
                            </Link>
                            <Link
                                href={libraryIndex.url({ query: { availability: "online" } })}
                                className={cn(
                                    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
                                    isEbooksTab
                                        ? "bg-muted text-foreground font-semibold"
                                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                )}
                            >
                                <BookOpen className="size-3.5" />
                                Read Online eBooks
                            </Link>
                        </nav>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <AnimatedThemeToggler className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none sm:size-9 [&_svg]:size-4" />

                        <a
                            href={loginUrl}
                            className={cn(
                                buttonVariants({ variant: "outline", size: "sm" }),
                                "h-10 gap-1.5 rounded-lg px-3 text-xs font-semibold transition-transform active:scale-[0.96] sm:h-9",
                            )}
                        >
                            <LogIn className="size-3.5" />
                            <span>Sign in</span>
                        </a>

                        <a
                            href={signupUrl}
                            className={cn(
                                buttonVariants({ variant: "default", size: "sm" }),
                                "hidden h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-xs transition-transform active:scale-[0.96] sm:inline-flex",
                            )}
                        >
                            <UserPlus className="size-3.5" />
                            <span>Create account</span>
                        </a>
                    </div>
                </div>
            </header>

            <main className={cn("mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8", bottomInsetClassName)}>
                {children}
            </main>

            <footer className="border-border/60 bg-muted/20 border-t">
                <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-xs sm:flex-row sm:px-6 sm:text-left lg:px-8">
                    <div className="text-muted-foreground space-y-0.5">
                        <p className="text-foreground font-medium">{branding.organizationName} Digital Library</p>
                        <p>Read published PDF eBooks free in your browser. Sign in to download licensed copies and sync bookmarks.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <a href={loginUrl} className="text-foreground hover:text-primary font-medium underline-offset-4 hover:underline">
                            Sign in
                        </a>
                        <span className="text-border">•</span>
                        <a href={signupUrl} className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
                            Create account
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
