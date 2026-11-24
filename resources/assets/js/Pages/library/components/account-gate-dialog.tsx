import { buttonVariants } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Bookmark, CheckCircle2, Download, Heart, Lock, LogIn, UserPlus } from "lucide-react";

export type AccountGateReason = "download" | "favorite" | "bookmark";

interface AccountGateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    reason: AccountGateReason;
    bookTitle?: string;
    fileSizeLabel?: string | null;
    signInUrl: string;
    signUpUrl: string;
}

const COPY: Record<
    AccountGateReason,
    {
        badge: string;
        title: string;
        description: (bookTitle?: string) => string;
        primaryLabel: string;
    }
> = {
    download: {
        badge: "Account required to download",
        title: "Sign in to download this PDF",
        description: (bookTitle) =>
            bookTitle
                ? `You can read “${bookTitle}” online right now without an account. Sign in or create a free account to download the PDF copy.`
                : "Reading online is completely free without an account. Sign in or create a free account to download PDF copies.",
        primaryLabel: "Sign in to download",
    },
    favorite: {
        badge: "Personal reading shelf",
        title: "Sign in to save books to your shelf",
        description: (bookTitle) =>
            bookTitle
                ? `Sign in to save “${bookTitle}” to your personal reading list and access it from any device.`
                : "Sign in to build your personal saved shelf and access your favorite books from any device.",
        primaryLabel: "Sign in to save",
    },
    bookmark: {
        badge: "Sync across devices",
        title: "Sign in to sync your bookmarks",
        description: () =>
            "Your bookmarks are saved locally on this device while reading as a guest. Sign in to sync bookmarks and reading progress across all devices.",
        primaryLabel: "Sign in to sync",
    },
};

export function AccountGateDialog({
    open,
    onOpenChange,
    reason,
    bookTitle,
    fileSizeLabel,
    signInUrl,
    signUpUrl,
}: AccountGateDialogProps) {
    const content = COPY[reason];
    const ReasonIcon = reason === "download" ? Download : reason === "favorite" ? Heart : Bookmark;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-5 rounded-2xl p-6 sm:max-w-md">
                <DialogHeader className="space-y-3 text-left">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary/10 text-primary ring-primary/15 relative flex size-11 shrink-0 items-center justify-center rounded-xl ring-1">
                            <ReasonIcon className="size-5" />
                            <span className="bg-background ring-border absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-1">
                                <Lock className="text-muted-foreground size-2.5" />
                            </span>
                        </div>
                        <span className="text-primary text-[11px] font-semibold tracking-wider uppercase">{content.badge}</span>
                    </div>
                    <DialogTitle className="font-serif text-xl font-semibold tracking-tight text-balance">
                        {content.title}
                    </DialogTitle>
                    <DialogDescription className="text-sm leading-relaxed text-pretty">
                        {content.description(bookTitle)}
                    </DialogDescription>
                </DialogHeader>

                <div className="bg-muted/45 border-border/70 space-y-2.5 rounded-xl border p-3.5 text-xs">
                    <p className="text-foreground font-semibold">Included with a free account</p>
                    <ul className="text-muted-foreground space-y-2">
                        <li className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span>
                                Download licensed PDF eBooks for offline reading
                                {fileSizeLabel ? ` (${fileSizeLabel})` : ""}
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span>Resume automatically from your last read page across devices</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span>Save favorite volumes and personal page bookmarks</span>
                        </li>
                    </ul>
                </div>

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                    <a
                        href={signInUrl}
                        className={cn(
                            buttonVariants({ size: "default" }),
                            "h-11 w-full gap-2 rounded-xl font-semibold shadow-xs transition-transform active:scale-[0.96]",
                        )}
                    >
                        <LogIn className="size-4" />
                        {content.primaryLabel}
                    </a>
                    <a
                        href={signUpUrl}
                        className={cn(
                            buttonVariants({ variant: "outline", size: "default" }),
                            "h-11 w-full gap-2 rounded-xl font-semibold transition-transform active:scale-[0.96]",
                        )}
                    >
                        <UserPlus className="size-4" />
                        Create free account
                    </a>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
