import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, FileText, Image as ImageIcon, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { CatalogRelationField, type CatalogOption } from "./catalog-entry-controls";
import type { AiCatalogAssistAvailability, PdfInspectionResponse } from "./copyright-scan-panel";

export interface PdfMetadataDraft {
    title: string;
    author_id: string;
    category_id: string;
    publisher: string;
    publication_year: string;
    isbn: string;
    pages: string;
    description: string;
}

interface PdfMetadataModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileName: string | null;
    inspection: PdfInspectionResponse | null;
    aiCatalogAssist?: AiCatalogAssistAvailability;
    reanalyzingWithAi?: boolean;
    onReanalyzeWithAi?: () => void;
    currentValues: PdfMetadataDraft;
    authorOptions: CatalogOption[];
    categoryOptions: CatalogOption[];
    onAuthorCreated?: (option: CatalogOption) => void;
    onCategoryCreated?: (option: CatalogOption) => void;
    pageOneCoverPreview: string | null;
    renderingCover: boolean;
    coverApplied: boolean;
    onApplyPageOneCover?: () => void;
    onApplyMetadata: (values: PdfMetadataDraft) => void;
}

const FIELD_LABELS: Record<string, string> = {
    title: "Title",
    author: "Author",
    category: "Category",
    publisher: "Publisher",
    publication_year: "Publication Year",
    description: "Description",
    isbn: "ISBN",
};

export function PdfMetadataModal({
    open,
    onOpenChange,
    fileName,
    inspection,
    aiCatalogAssist,
    reanalyzingWithAi = false,
    onReanalyzeWithAi,
    currentValues,
    authorOptions,
    categoryOptions,
    onAuthorCreated,
    onCategoryCreated,
    pageOneCoverPreview,
    renderingCover,
    coverApplied,
    onApplyPageOneCover,
    onApplyMetadata,
}: PdfMetadataModalProps) {
    const [draft, setDraft] = useState<PdfMetadataDraft>(currentValues);

    useEffect(() => {
        if (!open) return;

        const meta = inspection?.metadata;
        setDraft({
            title: currentValues.title || meta?.suggested_title || "",
            author_id: currentValues.author_id || (meta?.matched_author_id ? String(meta.matched_author_id) : ""),
            category_id: currentValues.category_id || (meta?.matched_category_id ? String(meta.matched_category_id) : ""),
            publisher: currentValues.publisher || meta?.publisher || "",
            publication_year: currentValues.publication_year || (meta?.publication_year ? String(meta.publication_year) : ""),
            isbn: currentValues.isbn || meta?.isbn || "",
            pages: currentValues.pages || (meta?.pages ? String(meta.pages) : ""),
            description: currentValues.description || meta?.description || "",
        });
    }, [open, currentValues, inspection]);

    const aiDecision = inspection?.ai_decision ?? inspection?.rights_scan.ai_decision ?? null;
    const aiEnriched = new Set(inspection?.metadata.ai_enriched_fields ?? []);
    const missingFields = inspection?.missing_fields ?? [];
    const extractedSummary = [
        inspection?.metadata.title ? "Title" : null,
        inspection?.metadata.author ? "Author" : null,
        inspection?.metadata.category ? "Category" : null,
        inspection?.metadata.pages
            ? `${inspection.metadata.pages} ${inspection.metadata.pages === 1 ? "page" : "pages"}`
            : null,
        inspection?.metadata.isbn ? `ISBN ${inspection.metadata.isbn}` : null,
        inspection?.metadata.publication_year ? `Year ${inspection.metadata.publication_year}` : null,
        inspection?.metadata.publisher ? "Publisher" : null,
    ].filter((item): item is string => Boolean(item));

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApplyMetadata(draft);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-hidden rounded-2xl p-0 sm:max-w-2xl" data-testid="pdf-metadata-modal">
                <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col">
                    <DialogHeader className="border-b px-6 py-5 pr-11 text-left">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                                    <Wand2 className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <DialogTitle className="text-lg">Review &amp; Attach PDF Metadata</DialogTitle>
                                        {aiDecision?.used && (
                                            <Badge className="gap-1 bg-violet-600/12 text-[11px] text-violet-800 hover:bg-violet-600/15 dark:text-violet-200">
                                                <Sparkles className="size-3" />
                                                Laravel AI
                                            </Badge>
                                        )}
                                    </div>
                                    <DialogDescription className="mt-1 text-pretty">
                                        {fileName ? (
                                            <>
                                                We analyzed <span className="text-foreground font-medium">{fileName}</span>. Confirm or quick-create
                                                the detected Author and Category below so readers can browse this eBook easily.
                                            </>
                                        ) : (
                                            "Attach or refine catalog metadata for this PDF eBook before saving it as a draft."
                                        )}
                                    </DialogDescription>
                                </div>
                            </div>

                            {onReanalyzeWithAi && aiCatalogAssist?.available && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={reanalyzingWithAi}
                                    onClick={onReanalyzeWithAi}
                                    className="shrink-0 gap-1.5 rounded-xl text-xs"
                                    data-testid="modal-rerun-ai"
                                >
                                    {reanalyzingWithAi ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                                    {reanalyzingWithAi ? "Analyzing…" : "AI Re-analyze"}
                                </Button>
                            )}
                        </div>
                    </DialogHeader>

                    <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                        {/* Laravel AI Decision Summary */}
                        {aiDecision?.used && aiDecision.decision_summary && (
                            <div
                                className="rounded-2xl border border-violet-500/25 bg-violet-50/75 p-3.5 text-xs dark:border-violet-400/25 dark:bg-violet-950/25"
                                data-testid="modal-ai-decision-banner"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="flex items-center gap-1.5 font-semibold text-violet-900 dark:text-violet-200">
                                        <Sparkles className="size-3.5" />
                                        Laravel AI Catalog Decision
                                    </span>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {aiDecision.confidence && (
                                            <Badge variant="outline" className="text-[10px] capitalize">
                                                {aiDecision.confidence} confidence
                                            </Badge>
                                        )}
                                        {aiDecision.provider && (
                                            <Badge variant="secondary" className="text-[10px]">
                                                {aiDecision.provider}
                                                {aiDecision.model ? ` · ${aiDecision.model}` : ""}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <p className="text-muted-foreground mt-1.5 leading-5">{aiDecision.decision_summary}</p>
                            </div>
                        )}

                        {/* Extracted vs Missing Summary */}
                        <div className="bg-muted/35 grid gap-4 rounded-2xl border p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="space-y-2.5">
                                {extractedSummary.length > 0 && (
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                                            Detected from PDF{aiDecision?.used ? " & Laravel AI" : ""}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {extractedSummary.map((item) => (
                                                <Badge
                                                    key={item}
                                                    className="gap-1 bg-emerald-500/12 text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                                                >
                                                    <CheckCircle2 className="size-3" />
                                                    {item}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {missingFields.length > 0 && (
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                                            Still missing
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {missingFields.map((field) => (
                                                <Badge
                                                    key={field}
                                                    className="bg-amber-500/12 text-[11px] text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
                                                >
                                                    {FIELD_LABELS[field] ?? field}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Page 1 Cover Generator */}
                            {(pageOneCoverPreview || renderingCover) && (
                                <div className="flex flex-col items-center gap-2 sm:w-32">
                                    <div className="bg-background relative flex h-32 w-24 items-center justify-center overflow-hidden rounded-xl border shadow-2xs">
                                        {renderingCover ? (
                                            <Loader2 className="text-muted-foreground size-5 animate-spin" />
                                        ) : pageOneCoverPreview ? (
                                            <img
                                                src={pageOneCoverPreview}
                                                alt="PDF page 1 preview"
                                                className="h-full w-full object-contain"
                                            />
                                        ) : (
                                            <FileText className="text-muted-foreground size-6" />
                                        )}
                                    </div>
                                    {pageOneCoverPreview && onApplyPageOneCover && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={coverApplied ? "secondary" : "outline"}
                                            className="h-8 w-full gap-1.5 rounded-lg px-2 text-xs"
                                            onClick={onApplyPageOneCover}
                                            data-testid="modal-use-page1-cover"
                                        >
                                            {coverApplied ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <ImageIcon className="size-3.5" />}
                                            {coverApplied ? "Cover set" : "Use Page 1"}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label htmlFor="modal_meta_title">Book Title</Label>
                                <Input
                                    id="modal_meta_title"
                                    value={draft.title}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                                    placeholder="Enter the book title"
                                    className="h-10 rounded-xl"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <CatalogRelationField
                                    id="modal_meta_author"
                                    kind="author"
                                    options={authorOptions}
                                    value={draft.author_id}
                                    onValueChange={(value) => setDraft((prev) => ({ ...prev, author_id: value }))}
                                    onOptionCreated={onAuthorCreated}
                                    suggestedName={inspection?.metadata.author}
                                    suggestionSource={aiEnriched.has("author") ? "ai" : "pdf"}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <CatalogRelationField
                                    id="modal_meta_category"
                                    kind="category"
                                    options={categoryOptions}
                                    value={draft.category_id}
                                    onValueChange={(value) => setDraft((prev) => ({ ...prev, category_id: value }))}
                                    onOptionCreated={onCategoryCreated}
                                    suggestedName={inspection?.metadata.category}
                                    suggestionSource={aiEnriched.has("category") ? "ai" : "pdf"}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="modal_meta_publisher">Publisher / Journal</Label>
                                <Input
                                    id="modal_meta_publisher"
                                    value={draft.publisher}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, publisher: event.target.value }))}
                                    placeholder="Publisher, journal, or organization"
                                    className="h-10 rounded-xl"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="modal_meta_year">Publication Year</Label>
                                <Input
                                    id="modal_meta_year"
                                    type="number"
                                    value={draft.publication_year}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, publication_year: event.target.value }))}
                                    placeholder="YYYY"
                                    className="h-10 rounded-xl tabular-nums"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="modal_meta_isbn">ISBN</Label>
                                <Input
                                    id="modal_meta_isbn"
                                    value={draft.isbn}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, isbn: event.target.value }))}
                                    placeholder="978-…"
                                    className="h-10 rounded-xl"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="modal_meta_pages">Pages</Label>
                                <Input
                                    id="modal_meta_pages"
                                    type="number"
                                    value={draft.pages}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, pages: event.target.value }))}
                                    placeholder="Total pages"
                                    className="h-10 rounded-xl tabular-nums"
                                />
                            </div>

                            <div className="space-y-1.5 sm:col-span-2">
                                <Label htmlFor="modal_meta_description">Description / Abstract</Label>
                                <Textarea
                                    id="modal_meta_description"
                                    rows={3}
                                    value={draft.description}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                                    placeholder="Short synopsis shown on the public library catalog and eBook page"
                                    className="rounded-xl"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="border-t px-6 py-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Fill later on form
                        </Button>
                        <Button type="submit" className="gap-1.5" data-testid="apply-pdf-metadata">
                            <Sparkles className="size-4" />
                            Apply metadata to book
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
