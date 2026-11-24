import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    AlertTriangle,
    BookMarked,
    ChevronDown,
    ChevronUp,
    FileCheck2,
    FileWarning,
    Info,
    ShieldAlert,
    ShieldBan,
    ShieldCheck,
    Sparkles,
    Trash2,
    UploadCloud,
} from "lucide-react";
import { useState } from "react";

export type RightsRiskLevel = "critical" | "high" | "review" | "open" | "neutral";

export interface RightsScanFinding {
    code: string;
    severity: RightsRiskLevel | string;
    title: string;
    detail: string;
    page: number | null;
    snippet: string | null;
}

export interface SuggestedRights {
    rights_basis: string | null;
    rights_holder: string | null;
    license_url: string | null;
    requires_documented_permission: boolean;
}

export interface RightsScanResult {
    scanned_at: string;
    risk_level: RightsRiskLevel;
    piracy_blocked: boolean;
    piracy_sources: string[];
    summary: string;
    pages_scanned: number[];
    image_only_scan: boolean;
    findings: RightsScanFinding[];
    suggested_rights: SuggestedRights;
}

export interface PdfInspectionMetadata {
    title: string | null;
    suggested_title: string | null;
    author: string | null;
    matched_author_id: number | null;
    matched_author_name: string | null;
    description: string | null;
    publisher: string | null;
    publication_year: number | null;
    isbn: string | null;
    pages: number | null;
    creator: string | null;
    producer: string | null;
    has_embedded_metadata: boolean;
}

export interface PdfInspectionResponse {
    metadata: PdfInspectionMetadata;
    missing_fields: string[];
    needs_metadata_review: boolean;
    rights_scan: RightsScanResult;
}

interface CopyrightScanPanelProps {
    scan: RightsScanResult;
    publicationYear?: number | null;
    selectedRightsBasis?: string | null;
    mode: "create" | "edit";
    onAutoFillLicense?: (suggested: SuggestedRights) => void;
    onApplySafeDefaults?: (scan: RightsScanResult) => void;
    onReplacePdf?: () => void;
    onDiscardOrConvertToPhysical?: () => void;
    className?: string;
}

const RISK_STYLES: Record<
    RightsRiskLevel,
    {
        container: string;
        iconWrap: string;
        badge: string;
        badgeLabel: string;
        heading: string;
        Icon: typeof ShieldCheck;
    }
> = {
    critical: {
        container: "border-rose-600/40 bg-rose-50/90 dark:border-rose-500/40 dark:bg-rose-950/30",
        iconWrap: "bg-rose-600 text-white",
        badge: "bg-rose-600 text-white hover:bg-rose-600",
        badgeLabel: "Piracy Blocked",
        heading: "Publishing blocked — unauthorized piracy source detected",
        Icon: ShieldBan,
    },
    high: {
        container: "border-amber-600/35 bg-amber-50/85 dark:border-amber-500/35 dark:bg-amber-950/25",
        iconWrap: "bg-amber-600 text-white",
        badge: "bg-amber-600/15 text-amber-800 hover:bg-amber-600/20 dark:text-amber-200",
        badgeLabel: "Copyright Notice Detected",
        heading: "Copyright restriction or commercial publisher detected",
        Icon: ShieldAlert,
    },
    review: {
        container: "border-amber-500/30 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-950/15",
        iconWrap: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        badge: "bg-amber-500/15 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200",
        badgeLabel: "Manual Review Needed",
        heading: "Manual copyright verification required",
        Icon: AlertTriangle,
    },
    open: {
        container: "border-emerald-600/30 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-950/20",
        iconWrap: "bg-emerald-600 text-white",
        badge: "bg-emerald-600/15 text-emerald-800 hover:bg-emerald-600/20 dark:text-emerald-200",
        badgeLabel: "Open License Detected",
        heading: "Open license or public-domain indicator found",
        Icon: ShieldCheck,
    },
    neutral: {
        container: "border-sky-600/25 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-950/20",
        iconWrap: "bg-sky-600/15 text-sky-700 dark:text-sky-300",
        badge: "bg-sky-600/15 text-sky-800 hover:bg-sky-600/20 dark:text-sky-200",
        badgeLabel: "No Notices Detected",
        heading: "No explicit copyright notices found in sampled pages",
        Icon: Info,
    },
};

export function CopyrightScanPanel({
    scan,
    publicationYear,
    selectedRightsBasis,
    mode,
    onAutoFillLicense,
    onApplySafeDefaults,
    onReplacePdf,
    onDiscardOrConvertToPhysical,
    className,
}: CopyrightScanPanelProps) {
    const [showAllFindings, setShowAllFindings] = useState(false);

    const riskLevel: RightsRiskLevel = scan.piracy_blocked ? "critical" : (scan.risk_level ?? "neutral");
    const theme = RISK_STYLES[riskLevel] ?? RISK_STYLES.neutral;
    const StatusIcon = theme.Icon;

    const hasPublicDomainYearConflict =
        !scan.piracy_blocked &&
        selectedRightsBasis === "public_domain" &&
        typeof publicationYear === "number" &&
        !Number.isNaN(publicationYear) &&
        publicationYear >= 1930;

    const canAutoFillOpenLicense =
        !scan.piracy_blocked &&
        riskLevel === "open" &&
        Boolean(onAutoFillLicense) &&
        Boolean(scan.suggested_rights?.rights_basis || scan.suggested_rights?.license_url || scan.suggested_rights?.rights_holder);

    const canApplySafeDefaults =
        !scan.piracy_blocked && (riskLevel === "high" || riskLevel === "review" || hasPublicDomainYearConflict) && Boolean(onApplySafeDefaults);

    const allFindings = scan.findings ?? [];
    const hiddenFindingCount = Math.max(0, allFindings.length - 2);
    const visibleFindings = showAllFindings ? allFindings : allFindings.slice(0, 2);

    const hasActions = Boolean(canAutoFillOpenLicense || canApplySafeDefaults || onReplacePdf || onDiscardOrConvertToPhysical);

    return (
        <div
            className={cn("rounded-2xl border p-4 transition-colors sm:p-5", theme.container, className)}
            data-testid="copyright-scan-panel"
            data-risk-level={riskLevel}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", theme.iconWrap)}>
                        <StatusIcon className="size-4.5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-foreground text-sm font-semibold">{theme.heading}</p>
                            <Badge className={cn("text-[11px] font-semibold", theme.badge)}>{theme.badgeLabel}</Badge>
                        </div>
                        <p className="text-muted-foreground text-xs leading-5 text-pretty">{scan.summary}</p>
                        {scan.pages_scanned && scan.pages_scanned.length > 0 && (
                            <p className="text-muted-foreground/85 text-[11px]">
                                Screened metadata and {scan.pages_scanned.length} boundary page{scan.pages_scanned.length === 1 ? "" : "s"} (pages{" "}
                                {scan.pages_scanned.join(", ")}).
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {hasPublicDomainYearConflict && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-600/30 bg-amber-100/70 p-3 text-xs text-amber-950 dark:bg-amber-950/50 dark:text-amber-100">
                    <FileWarning className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
                    <p className="leading-5">
                        <strong>Public-domain year warning:</strong> This book has a publication year of <strong>{publicationYear}</strong>, which is
                        usually still under copyright unless formally released into the public domain. Document the public-domain release in Rights
                        Notes or switch to Written Permission / Institutional License.
                    </p>
                </div>
            )}

            {/* Guided Issue Resolution Actions — kept immediately above findings so users never have to hunt below the fold */}
            {hasActions && (
                <div className="border-border/50 mt-3.5 flex flex-wrap items-center gap-2 border-t pt-3.5">
                    {canAutoFillOpenLicense && onAutoFillLicense && (
                        <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => onAutoFillLicense(scan.suggested_rights)}
                            data-testid="resolve-autofill-license"
                        >
                            <Sparkles className="size-3.5" />
                            Auto-fill detected license
                        </Button>
                    )}

                    {canApplySafeDefaults && onApplySafeDefaults && (
                        <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="gap-1.5 rounded-xl bg-amber-600 text-white hover:bg-amber-700"
                            onClick={() => onApplySafeDefaults(scan)}
                            data-testid="resolve-safe-defaults"
                        >
                            <FileCheck2 className="size-3.5" />
                            {riskLevel === "high" ? "Apply safe defaults & document permission" : "Pre-fill manual review checklist"}
                        </Button>
                    )}

                    {onReplacePdf && (
                        <Button
                            type="button"
                            size="sm"
                            variant={scan.piracy_blocked ? "default" : "outline"}
                            className="gap-1.5 rounded-xl"
                            onClick={onReplacePdf}
                            data-testid="resolve-replace-pdf"
                        >
                            <UploadCloud className="size-3.5" />
                            Replace PDF
                        </Button>
                    )}

                    {onDiscardOrConvertToPhysical && (
                        <Button
                            type="button"
                            size="sm"
                            variant={scan.piracy_blocked ? "destructive" : "outline"}
                            className="gap-1.5 rounded-xl"
                            onClick={onDiscardOrConvertToPhysical}
                            data-testid="resolve-discard-pdf"
                        >
                            {mode === "create" ? <BookMarked className="size-3.5" /> : <Trash2 className="size-3.5" />}
                            {mode === "create" ? "Discard PDF & switch to Physical" : "Remove PDF"}
                        </Button>
                    )}
                </div>
            )}

            {visibleFindings.length > 0 && (
                <div className="mt-3.5 space-y-2">
                    {visibleFindings.map((finding, index) => (
                        <div
                            key={`${finding.code}-${index}`}
                            className="bg-background/80 border-border/70 rounded-xl border px-3.5 py-2.5 text-xs shadow-2xs"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-foreground font-medium">{finding.title}</span>
                                <Badge variant="outline" className="text-[10px] font-medium">
                                    {finding.page ? `Page ${finding.page}` : "PDF Metadata"}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground mt-1 leading-5">{finding.detail}</p>
                            {finding.snippet && (
                                <p className="bg-muted/70 text-muted-foreground mt-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px] leading-relaxed break-words">
                                    “{finding.snippet}”
                                </p>
                            )}
                        </div>
                    ))}

                    {hiddenFindingCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowAllFindings((expanded) => !expanded)}
                            className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1.5 pt-1 text-xs font-medium underline-offset-4 hover:underline"
                        >
                            {showAllFindings ? (
                                <>
                                    <ChevronUp className="size-3.5" />
                                    Show fewer findings
                                </>
                            ) : (
                                <>
                                    <ChevronDown className="size-3.5" />
                                    Show all {allFindings.length} screening findings (+{hiddenFindingCount} more)
                                </>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
