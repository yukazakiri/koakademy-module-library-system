import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";

interface BookCoverProps {
    title: string;
    author?: string | null;
    coverUrl?: string | null;
    className?: string;
    priority?: boolean;
}

const PALETTES = [
    "from-amber-900 via-orange-900 to-stone-950",
    "from-emerald-900 via-teal-900 to-slate-950",
    "from-sky-900 via-blue-900 to-slate-950",
    "from-rose-900 via-red-900 to-stone-950",
    "from-indigo-900 via-slate-900 to-zinc-950",
];

function paletteFor(title: string): string {
    const seed = [...title].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return PALETTES[seed % PALETTES.length];
}

export function BookCover({ title, author, coverUrl, className, priority = false }: BookCoverProps) {
    if (coverUrl) {
        return (
            <div className={cn("relative h-full w-full overflow-hidden", className)}>
                <img
                    src={coverUrl}
                    alt={`Cover of ${title}`}
                    className="h-full w-full object-cover"
                    loading={priority ? "eager" : "lazy"}
                />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10 dark:ring-white/10"
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "relative flex h-full w-full flex-col overflow-hidden bg-linear-to-br p-4 text-white shadow-inner sm:p-5",
                paletteFor(title),
                className,
            )}
            role="img"
            aria-label={`Decorative cover placeholder for ${title}`}
        >
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10 dark:ring-white/10" />
            <div className="absolute inset-y-0 left-2.5 w-px bg-white/20 sm:left-3" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,white_0,transparent_34%),linear-gradient(115deg,transparent_45%,white_46%,transparent_47%)] opacity-15" />
            <BookOpen className="relative size-4 text-white/75 sm:size-5" aria-hidden="true" />
            <div className="relative mt-auto space-y-1.5 sm:space-y-2">
                <div className="h-px w-8 bg-amber-300/80 sm:w-10" />
                <p className="line-clamp-4 font-serif text-sm leading-snug font-semibold text-balance sm:text-base">{title}</p>
                {author && (
                    <p className="line-clamp-2 text-[10px] font-medium tracking-[0.14em] text-white/75 uppercase sm:text-[11px]">
                        {author}
                    </p>
                )}
            </div>
        </div>
    );
}
