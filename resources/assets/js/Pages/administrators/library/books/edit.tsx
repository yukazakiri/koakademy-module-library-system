import {
    destroy as destroyDigitalEdition,
    store as storeDigitalEdition,
    update as updateDigitalEdition,
} from "@/actions/Modules/LibrarySystem/Http/Controllers/AdministratorDigitalEditionController";
import {
    inspectPdf,
    store as storeBook,
    update as updateBook,
} from "@/actions/Modules/LibrarySystem/Http/Controllers/AdministratorLibraryBookController";
import AdminLayout from "@/components/administrators/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { index as libraryBooksIndex } from "@/routes/administrators/library/books";
import { read as readDigitalBook } from "@/routes/library/books";
import type { User } from "@/types/user";
import { Head, Link, router, useForm, usePage } from "@inertiajs/react";
import {
    ArrowDown,
    ArrowLeft,
    BookMarked,
    BookOpen,
    BookPlus,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Copy,
    Download,
    FileCheck2,
    FileText,
    Image as ImageIcon,
    Layers,
    Loader2,
    Save,
    ShieldBan,
    ShieldCheck,
    Sparkles,
    Trash2,
    UploadCloud,
    Wand2,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { CatalogIdentifierField, CatalogRelationField, type CatalogOption } from "./components/catalog-entry-controls";
import {
    CopyrightScanPanel,
    type PdfInspectionResponse,
    type RightsRiskLevel,
    type RightsScanResult,
    type SuggestedRights,
} from "./components/copyright-scan-panel";
import { PdfMetadataModal, type PdfMetadataDraft } from "./components/pdf-metadata-modal";

type BookFormatValue = "physical" | "ebook" | "hybrid";

interface BookFormData {
    format: BookFormatValue;
    title: string;
    isbn: string;
    call_number: string;
    accession_number: string;
    author_id: string;
    category_id: string;
    publisher: string;
    publication_year: string;
    pages: string;
    description: string;
    cover_image: string;
    cover_image_upload: File | null;
    total_copies: string;
    available_copies: string;
    location: string;
    status: string;
    digital_pdf: File | null;
    digital_rights_basis: string;
    digital_rights_holder: string;
    digital_license_url: string;
    digital_rights_notes: string;
    digital_rights_expires_at: string;
}

interface DigitalEditionRecord {
    id: number;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    status: "draft" | "published";
    downloads_allowed: boolean;
    rights_basis: string | null;
    rights_holder: string | null;
    license_url: string | null;
    rights_notes: string | null;
    rights_scan: RightsScanResult | null;
    rights_risk_level: RightsRiskLevel | null;
    is_piracy_blocked: boolean;
    rights_expires_at: string | null;
    uploaded_at: string | null;
    published_at: string | null;
}

interface BookRecord {
    id: number;
    format: BookFormatValue;
    title: string;
    isbn: string | null;
    call_number: string | null;
    accession_number: string | null;
    author_id: number;
    category_id: number;
    publisher: string | null;
    publication_year: number | null;
    pages: number | null;
    description: string | null;
    cover_image: string | null;
    cover_image_url?: string | null;
    total_copies: number;
    available_copies: number;
    location: string | null;
    status: string;
    digital_edition: DigitalEditionRecord | null;
    can_manage_digital_edition: boolean;
}

interface Props {
    user: User;
    book: BookRecord | null;
    initial_format?: BookFormatValue;
    can_manage_digital_edition?: boolean;
    options: {
        authors: CatalogOption[];
        categories: CatalogOption[];
        statuses: CatalogOption[];
        formats?: CatalogOption[];
        digital_rights_bases: CatalogOption[];
    };
    flash?: {
        type: string;
        message: string;
    };
}

interface BookPageProps {
    errors?: Record<string, unknown>;
}

interface BookFormError {
    field: string;
    message: string;
}

const FORMAT_CARDS: {
    value: BookFormatValue;
    title: string;
    description: string;
    badge: string;
    Icon: typeof BookMarked;
}[] = [
    {
        value: "physical",
        title: "Physical Book",
        description: "Print copies tracked on library shelves with call numbers and borrowing.",
        badge: "Print inventory",
        Icon: BookMarked,
    },
    {
        value: "ebook",
        title: "eBook (PDF)",
        description: "Digital-only PDF hosted for open browser reading. Always starts as a Draft.",
        badge: "No shelf copies",
        Icon: FileText,
    },
    {
        value: "hybrid",
        title: "Physical + eBook",
        description: "Print copies available on shelf plus a hosted PDF edition for online reading.",
        badge: "Print & Digital",
        Icon: Layers,
    },
];

function getCsrfHeaders(): Record<string, string> {
    if (typeof document === "undefined") {
        return {};
    }

    const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
    };

    const xsrfCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("XSRF-TOKEN="))
        ?.split("=")[1];

    if (xsrfCookie) {
        headers["X-XSRF-TOKEN"] = decodeURIComponent(xsrfCookie);
    } else {
        const metaToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
        if (metaToken) {
            headers["X-CSRF-TOKEN"] = metaToken;
        }
    }

    return headers;
}

async function requestPdfInspection(file: File): Promise<PdfInspectionResponse> {
    const body = new FormData();
    body.append("pdf", file);

    const response = await fetch(inspectPdf.url(), {
        method: "POST",
        credentials: "same-origin",
        headers: getCsrfHeaders(),
        body,
    });

    if (!response.ok) {
        let message = "Could not inspect the PDF file.";
        try {
            const payload = (await response.json()) as { message?: string; errors?: { pdf?: string[] } };
            message = payload.errors?.pdf?.[0] ?? payload.message ?? message;
        } catch {
            // Keep default message
        }
        throw new Error(message);
    }

    return (await response.json()) as PdfInspectionResponse;
}

async function renderPdfPageOneCover(file: File): Promise<{ file: File; previewUrl: string } | null> {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const [pdfjs, workerModule] = await Promise.all([
            import("pdfjs-dist"),
            import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);

        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

        const buffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        const pdf = await loadingTask.promise;

        try {
            const page = await pdf.getPage(1);
            const baseViewport = page.getViewport({ scale: 1 });
            const targetWidth = 640;
            const scale = Math.min(2, Math.max(0.5, targetWidth / Math.max(1, baseViewport.width)));
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);

            const context = canvas.getContext("2d");
            if (!context) {
                return null;
            }

            await page.render({ canvas, canvasContext: context, viewport }).promise;

            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
            if (!blob) {
                return null;
            }

            const safeBaseName = file.name.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "ebook-cover";
            const coverFile = new File([blob], `${safeBaseName}-cover.jpg`, { type: "image/jpeg" });
            const previewUrl = URL.createObjectURL(coverFile);

            return { file: coverFile, previewUrl };
        } finally {
            await loadingTask.destroy();
        }
    } catch {
        return null;
    }
}

function buildSafePermissionMemo(scan: RightsScanResult): string {
    const matchedTitles = scan.findings
        .filter((item) => item.severity === "high" || item.severity === "review")
        .map((item) => item.title)
        .slice(0, 3);

    const header =
        matchedTitles.length > 0
            ? `[Automated Copyright Screening — ${matchedTitles.join("; ")}]`
            : "[Automated Copyright Screening — Manual review requested]";

    return `${header}\nPermission source / institutional license reference: (add written authorization details, license agreement, or librarian verification here before publishing).`;
}

function normalizeBookError(value: unknown): string | null {
    if (Array.isArray(value)) {
        const firstMessage = value.find((message): message is string => typeof message === "string" && message.trim() !== "");

        return firstMessage ?? null;
    }

    return typeof value === "string" && value.trim() !== "" ? value : null;
}

function getBookFormErrors(errors: object): BookFormError[] {
    return Object.entries(errors).flatMap(([field, value]) => {
        const message = normalizeBookError(value);

        return message ? [{ field, message }] : [];
    });
}

function getBookErrors(errors: Record<string, unknown>): Record<string, unknown> {
    const bookBag = errors.book;

    if (bookBag && typeof bookBag === "object" && !Array.isArray(bookBag)) {
        return bookBag as Record<string, unknown>;
    }

    if (Object.prototype.hasOwnProperty.call(errors, "digitalEdition")) {
        return {};
    }

    return errors;
}

export default function LibraryBookEdit({
    user,
    book,
    initial_format,
    can_manage_digital_edition,
    options,
    flash,
}: Props) {
    const resolvedInitialFormat: BookFormatValue = book?.format ?? initial_format ?? "physical";
    const canManageDigital = book ? book.can_manage_digital_edition : Boolean(can_manage_digital_edition);

    const form = useForm<BookFormData>({
        format: resolvedInitialFormat,
        title: book?.title ?? "",
        isbn: book?.isbn ?? "",
        call_number: book?.call_number ?? "",
        accession_number: book?.accession_number ?? "",
        author_id: book?.author_id ? String(book.author_id) : "",
        category_id: book?.category_id ? String(book.category_id) : "",
        publisher: book?.publisher ?? "",
        publication_year: book?.publication_year ? String(book.publication_year) : "",
        pages: book?.pages ? String(book.pages) : "",
        description: book?.description ?? "",
        cover_image: book?.cover_image ?? "",
        cover_image_upload: null,
        total_copies: book ? String(book.total_copies) : resolvedInitialFormat === "ebook" ? "0" : "1",
        available_copies: book ? String(book.available_copies) : resolvedInitialFormat === "ebook" ? "0" : "1",
        location: book?.location ?? "",
        status: book?.status ?? "available",
        digital_pdf: null,
        digital_rights_basis: "",
        digital_rights_holder: "",
        digital_license_url: "",
        digital_rights_notes: "",
        digital_rights_expires_at: "",
    });

    const page = usePage<BookPageProps>();
    const [authorOptions, setAuthorOptions] = useState<CatalogOption[]>(options.authors);
    const [categoryOptions, setCategoryOptions] = useState<CatalogOption[]>(options.categories);
    const [coverUploadPreview, setCoverUploadPreview] = useState<string | null>(null);
    const [bookErrors, setBookErrors] = useState<Record<string, unknown>>({});

    // Create-mode PDF inspection & metadata modal state
    const [inspectingPdf, setInspectingPdf] = useState(false);
    const [pdfInspection, setPdfInspection] = useState<PdfInspectionResponse | null>(null);
    const [pdfInspectError, setPdfInspectError] = useState<string | null>(null);
    const [metadataModalOpen, setMetadataModalOpen] = useState(false);
    const [pageOneCoverFile, setPageOneCoverFile] = useState<File | null>(null);
    const [pageOneCoverPreview, setPageOneCoverPreview] = useState<string | null>(null);
    const [renderingCover, setRenderingCover] = useState(false);
    const [pageOneCoverApplied, setPageOneCoverApplied] = useState(false);
    const [showCreateRightsPanel, setShowCreateRightsPanel] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    const errorSummaryRef = useRef<HTMLDivElement | null>(null);
    const createPdfInputRef = useRef<HTMLInputElement | null>(null);
    const createRightsNotesRef = useRef<HTMLTextAreaElement | null>(null);

    const isEbookOnly = form.data.format === "ebook";
    const supportsDigital = form.data.format === "ebook" || form.data.format === "hybrid";
    const coverPreview = coverUploadPreview ?? (form.data.cover_image ? form.data.cover_image : book?.cover_image_url ? book.cover_image_url : null);
    const HeaderIcon = book ? BookOpen : isEbookOnly ? FileText : BookPlus;
    const visibleBookErrors = Object.keys(bookErrors).length > 0 ? bookErrors : getBookErrors(page.props.errors ?? {});
    const bookFormErrors = getBookFormErrors(visibleBookErrors);
    const bookError = (field: string) => normalizeBookError(visibleBookErrors[field]);

    useEffect(() => {
        if (!flash?.message) return;
        if (flash.type === "error") {
            toast.error(flash.message, { id: "library-book-flash" });
        } else if (flash.type === "success") {
            toast.success(flash.message, { id: "library-book-flash" });
        } else {
            toast.message(flash.message, { id: "library-book-flash" });
        }
    }, [flash]);

    useEffect(() => {
        return () => {
            if (pageOneCoverPreview) {
                URL.revokeObjectURL(pageOneCoverPreview);
            }
        };
    }, [pageOneCoverPreview]);

    useEffect(() => {
        if (!book || typeof window === "undefined") return;
        if (window.location.hash !== "#digital-edition") return;

        const frame = window.requestAnimationFrame(() => {
            document.getElementById("digital-edition")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [book?.id]);

    const handleFormatChange = (nextFormat: BookFormatValue) => {
        if (book?.digital_edition && nextFormat === "physical") {
            toast.info("Remove the existing digital edition below first if this title is print-only.");
            return;
        }

        form.setData("format", nextFormat);

        if (nextFormat === "ebook") {
            form.setData("total_copies", "0");
            form.setData("available_copies", "0");
            form.setData("status", "available");
        } else {
            if (form.data.total_copies === "0" || form.data.total_copies === "") {
                form.setData("total_copies", "1");
                form.setData("available_copies", "1");
            }
        }

        if (nextFormat === "physical" && !book) {
            clearCreatePdf();
        }
    };

    const clearCreatePdf = () => {
        form.setData("digital_pdf", null);
        form.setData("digital_rights_basis", "");
        form.setData("digital_rights_holder", "");
        form.setData("digital_license_url", "");
        form.setData("digital_rights_notes", "");
        form.setData("digital_rights_expires_at", "");
        setPdfInspection(null);
        setPdfInspectError(null);
        setPageOneCoverFile(null);
        setPageOneCoverPreview(null);
        setPageOneCoverApplied(false);
        setShowCreateRightsPanel(false);
        if (createPdfInputRef.current) {
            createPdfInputRef.current.value = "";
        }
    };

    const handleCreatePdfSelection = async (file: File | null) => {
        if (!file) {
            clearCreatePdf();
            return;
        }

        if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            toast.error("Choose a valid PDF file.");
            return;
        }

        form.setData("digital_pdf", file);
        setPdfInspectError(null);
        setPdfInspection(null);
        setPageOneCoverFile(null);
        setPageOneCoverPreview(null);
        setPageOneCoverApplied(false);
        setInspectingPdf(true);
        setRenderingCover(true);

        // Render page 1 cover thumbnail on the client concurrently
        void renderPdfPageOneCover(file).then((rendered) => {
            setRenderingCover(false);
            if (rendered) {
                setPageOneCoverFile(rendered.file);
                setPageOneCoverPreview(rendered.previewUrl);
            }
        });

        try {
            const result = await requestPdfInspection(file);
            setPdfInspection(result);

            // Auto-fill empty catalog fields from PDF metadata
            const meta = result.metadata;
            const autoFilled: string[] = [];

            if (!form.data.title && meta.suggested_title) {
                form.setData("title", meta.suggested_title);
                autoFilled.push("title");
            }
            if (!form.data.author_id && meta.matched_author_id) {
                form.setData("author_id", String(meta.matched_author_id));
                autoFilled.push("author");
            }
            if (!form.data.publisher && meta.publisher) {
                form.setData("publisher", meta.publisher);
                autoFilled.push("publisher");
            }
            if (!form.data.publication_year && meta.publication_year) {
                form.setData("publication_year", String(meta.publication_year));
                autoFilled.push("year");
            }
            if (!form.data.isbn && meta.isbn) {
                form.setData("isbn", meta.isbn);
                autoFilled.push("ISBN");
            }
            if (!form.data.pages && meta.pages) {
                form.setData("pages", String(meta.pages));
                autoFilled.push("pages");
            }
            if (!form.data.description && meta.description) {
                form.setData("description", meta.description);
                autoFilled.push("description");
            }

            if (result.rights_scan.piracy_blocked) {
                toast.error("Piracy source watermark detected in this PDF.", {
                    description: "Publishing is blocked for this file. Replace it with a rights-cleared PDF or switch to Physical.",
                });
            } else if (result.rights_scan.risk_level === "high") {
                toast.warning("Copyright restriction notice detected.", {
                    description: "This eBook will stay in Draft until documented permission is recorded.",
                });
            } else if (autoFilled.length > 0) {
                toast.success(`Extracted ${autoFilled.join(", ")} from PDF.`);
            }

            if (result.needs_metadata_review && !result.rights_scan.piracy_blocked) {
                setMetadataModalOpen(true);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not inspect the PDF.";
            setPdfInspectError(message);
            toast.error("PDF inspection failed", { description: message });
        } finally {
            setInspectingPdf(false);
        }
    };

    const handleDropPdf = (event: DragEvent<HTMLLabelElement>) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files?.[0] ?? null;
        if (file) {
            void handleCreatePdfSelection(file);
        }
    };

    const applyPageOneAsCover = () => {
        if (!pageOneCoverFile || !pageOneCoverPreview) return;
        form.setData("cover_image_upload", pageOneCoverFile);
        setCoverUploadPreview(pageOneCoverPreview);
        setPageOneCoverApplied(true);
        toast.success("Page 1 set as the book cover.");
    };

    const applyMetadataFromModal = (values: PdfMetadataDraft) => {
        form.setData("title", values.title);
        form.setData("author_id", values.author_id);
        form.setData("category_id", values.category_id);
        form.setData("publisher", values.publisher);
        form.setData("publication_year", values.publication_year);
        form.setData("isbn", values.isbn);
        form.setData("pages", values.pages);
        form.setData("description", values.description);
        toast.success("PDF metadata applied to the book form.");
    };

    const handleCreateAutoFillLicense = (suggested: SuggestedRights) => {
        if (suggested.rights_basis) {
            form.setData("digital_rights_basis", suggested.rights_basis);
        }
        if (suggested.rights_holder) {
            form.setData("digital_rights_holder", suggested.rights_holder);
        }
        if (suggested.license_url) {
            form.setData("digital_license_url", suggested.license_url);
        }
        setShowCreateRightsPanel(true);
        toast.success("Detected open-license details pre-filled for your Draft edition.");
    };

    const handleCreateApplySafeDefaults = (scan: RightsScanResult) => {
        if (!form.data.digital_rights_basis || form.data.digital_rights_basis === "public_domain") {
            form.setData("digital_rights_basis", "written_permission");
        }
        if (!form.data.digital_rights_holder && scan.suggested_rights.rights_holder) {
            form.setData("digital_rights_holder", scan.suggested_rights.rights_holder);
        }
        const memo = buildSafePermissionMemo(scan);
        if (!form.data.digital_rights_notes.includes("[Automated Copyright Screening")) {
            form.setData("digital_rights_notes", form.data.digital_rights_notes ? `${form.data.digital_rights_notes}\n\n${memo}` : memo);
        }
        setShowCreateRightsPanel(true);
        toast.info("Safe draft defaults applied. Add your written permission details before publishing later.");
        window.setTimeout(() => {
            createRightsNotesRef.current?.focus();
            createRightsNotesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 60);
    };

    const handleCreateDiscardPdf = () => {
        clearCreatePdf();
        form.setData("format", "physical");
        if (form.data.total_copies === "0" || form.data.total_copies === "") {
            form.setData("total_copies", "1");
            form.setData("available_copies", "1");
        }
        toast.info("PDF discarded and book switched to Physical Book.");
    };

    const handleTotalCopiesChange = (value: string) => {
        const availableCopiesFollowTotal = !book && form.data.available_copies === form.data.total_copies;

        form.setData("total_copies", value);

        if (availableCopiesFollowTotal) {
            form.setData("available_copies", value);
        }
    };

    const handleRequestError = (errors: object) => {
        const scopedErrors = getBookErrors(errors as Record<string, unknown>);

        setBookErrors(scopedErrors);
        form.setError(scopedErrors);
        const errorCount = getBookFormErrors(scopedErrors).length;

        toast.error(book ? "Book could not be updated." : "Book could not be created.", {
            description:
                errorCount > 0 ? "Review the highlighted fields and try again." : "Please try again or contact support if the problem continues.",
        });

        window.setTimeout(() => {
            errorSummaryRef.current?.focus({ preventScroll: true });
            errorSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const creatingWithPdf = !book && Boolean(form.data.digital_pdf);

        const requestOptions = {
            errorBag: "book",
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => {
                setBookErrors({});
                if (!creatingWithPdf) {
                    toast.success(book ? "Book updated successfully." : "Book created successfully.", { id: "library-book-save" });
                }
            },
            onError: handleRequestError,
            onHttpException: () => {
                toast.error(book ? "Book could not be updated." : "Book could not be created.", {
                    description: "The server returned an unexpected response. Please try again.",
                });

                return false;
            },
            onNetworkError: () => {
                toast.error(book ? "Book could not be updated." : "Book could not be created.", {
                    description: "The connection was interrupted. Check your network and try again.",
                });

                return false;
            },
        };

        if (book) {
            form.transform((data) => ({ ...data, _method: "put" }));
            form.post(updateBook.url(book.id), requestOptions);
            return;
        }

        form.post(storeBook.url(), requestOptions);
    };

    const registerAuthorOption = (created: CatalogOption) => {
        setAuthorOptions((current) =>
            [...current.filter((item) => String(item.value) !== String(created.value)), created].sort((a, b) => a.label.localeCompare(b.label)),
        );
    };

    const registerCategoryOption = (created: CatalogOption) => {
        setCategoryOptions((current) =>
            [...current.filter((item) => String(item.value) !== String(created.value)), created].sort((a, b) => a.label.localeCompare(b.label)),
        );
    };

    const parsedPublicationYear = form.data.publication_year ? Number.parseInt(form.data.publication_year, 10) : null;
    const creatingWithPdf = !book && Boolean(form.data.digital_pdf);
    const submitButtonLabel = form.processing
        ? book
            ? "Saving…"
            : creatingWithPdf
              ? "Saving Draft eBook…"
              : "Creating…"
        : book
          ? "Save changes"
          : creatingWithPdf
            ? "Create eBook (Draft)"
            : isEbookOnly
              ? "Create eBook record"
              : "Create book";

    const identityStepNumber = !book && supportsDigital && canManageDigital ? 2 : 1;
    const sidebarStepNumber = identityStepNumber + 1;

    const remainingMissingMetadataCount = pdfInspection
        ? [
              !form.data.title.trim(),
              !form.data.author_id,
              !form.data.category_id,
              !form.data.publisher.trim(),
              !form.data.description.trim(),
          ].filter(Boolean).length
        : 0;

    return (
        <AdminLayout user={user} title={book ? "Edit Book" : isEbookOnly ? "Upload eBook" : "Add Book"}>
            <Head title={`Administrators • ${book ? "Edit" : isEbookOnly ? "Upload eBook" : "Add Book"}`} />

            <form onSubmit={handleSubmit} className="flex flex-col gap-6" data-testid="book-form">
                {bookFormErrors.length > 0 && (
                    <div
                        ref={errorSummaryRef}
                        id="book-form-errors"
                        data-testid="book-form-errors"
                        role="alert"
                        tabIndex={-1}
                        className="border-destructive/30 bg-destructive/10 text-destructive rounded-2xl border p-4 outline-none"
                    >
                        <p className="font-semibold">Review the highlighted fields before saving.</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {bookFormErrors.map(({ field, message }) => (
                                <li key={field}>
                                    <a className="underline underline-offset-2" href={`#${field}`}>
                                        {message}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* ── Header Banner ── */}
                <Card className="to-background relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/12 via-sky-500/5 shadow-xs ring-1 ring-emerald-700/10">
                    <div className="pointer-events-none absolute -top-20 -right-16 size-52 rounded-full bg-emerald-400/10 blur-3xl" />
                    <CardHeader className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 items-start gap-3.5">
                            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm shadow-emerald-900/15">
                                <HeaderIcon className="size-5" />
                            </div>
                            <div className="min-w-0 space-y-1">
                                <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase dark:text-emerald-300">
                                    {book ? "Catalog maintenance" : isEbookOnly ? "Single-step eBook entry" : "Fast catalog entry"}
                                </p>
                                <CardTitle className="text-xl text-balance">
                                    {book ? "Update catalog entry" : isEbookOnly ? "Upload & catalog an eBook (Draft)" : "Create a book record"}
                                </CardTitle>
                                <CardDescription className="max-w-2xl text-pretty">
                                    {book
                                        ? "Update catalog details, format classification, or manage the hosted PDF digital edition below."
                                        : "Choose whether this title is Physical, eBook (PDF), or Both. Uploaded PDFs are automatically screened for copyright & metadata and saved as Draft first."}
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {book?.digital_edition?.status === "draft" && (
                                <a
                                    href="#digital-edition"
                                    className={buttonVariants({
                                        variant: "secondary",
                                        className:
                                            "min-h-10 shrink-0 gap-1.5 whitespace-nowrap border border-amber-500/30 bg-amber-500/15 text-amber-900 hover:bg-amber-500/20 dark:text-amber-100",
                                    })}
                                >
                                    <ArrowDown className="size-4 shrink-0" />
                                    Review & Publish Draft
                                </a>
                            )}
                            <Link
                                href={libraryBooksIndex.url()}
                                prefetch
                                className={buttonVariants({
                                    variant: "outline",
                                    className: "min-h-10 shrink-0 gap-2 whitespace-nowrap transition-transform active:scale-[0.96]",
                                })}
                            >
                                <ArrowLeft className="size-4 shrink-0" />
                                Back to books
                            </Link>
                            <Button
                                nativeButton
                                type="submit"
                                size="lg"
                                className="shrink-0 whitespace-nowrap transition-transform active:scale-[0.96]"
                                disabled={form.processing}
                                data-testid="book-submit"
                            >
                                {form.processing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                                {submitButtonLabel}
                            </Button>
                        </div>
                    </CardHeader>
                </Card>

                {/* ── Format Selector ── */}
                <Card className="rounded-2xl shadow-xs">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <CardTitle className="text-base">Book format</CardTitle>
                                <CardDescription>
                                    Categorize whether this title has physical shelf copies, a hosted PDF eBook, or both.
                                </CardDescription>
                            </div>
                            {book?.digital_edition && (
                                <Badge variant="secondary" className="text-xs">
                                    PDF attached ({book.digital_edition.status === "published" ? "Published" : "Draft"})
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Book format">
                            {FORMAT_CARDS.map(({ value, title, description, badge, Icon }) => {
                                const selected = form.data.format === value;
                                const lockedByExistingPdf = Boolean(book?.digital_edition) && value === "physical";
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        disabled={lockedByExistingPdf}
                                        onClick={() => handleFormatChange(value)}
                                        data-testid={`format-option-${value}`}
                                        className={cn(
                                            "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
                                            selected
                                                ? "border-emerald-600 bg-emerald-500/8 ring-2 ring-emerald-600/20"
                                                : "border-border hover:border-primary/40 hover:bg-muted/30",
                                            lockedByExistingPdf && "cursor-not-allowed opacity-50",
                                        )}
                                    >
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <span
                                                className={cn(
                                                    "flex size-9 items-center justify-center rounded-xl",
                                                    selected ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
                                                )}
                                            >
                                                <Icon className="size-4.5" />
                                            </span>
                                            <Badge variant={selected ? "default" : "outline"} className="text-[11px]">
                                                {badge}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="text-foreground text-sm font-semibold">{title}</p>
                                            <p className="text-muted-foreground mt-0.5 text-xs leading-5 text-pretty">{description}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {bookError("format") && <p className="text-destructive mt-2 text-xs">{bookError("format")}</p>}
                    </CardContent>
                </Card>

                {/* ── Single-Step PDF Upload & Automated Screening (Create Mode Only) ── */}
                {!book && supportsDigital && canManageDigital && (
                    <Card className="overflow-hidden rounded-2xl border-sky-700/20 pt-0 shadow-xs" data-testid="create-ebook-pdf-card">
                        <CardHeader className="border-b bg-sky-50/70 pt-5 pb-4 dark:bg-sky-950/15">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-xs font-bold text-white">
                                        1
                                    </span>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CardTitle>Upload eBook PDF (Saved as Draft)</CardTitle>
                                            <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200">
                                                Always Draft First
                                            </Badge>
                                        </div>
                                        <CardDescription className="mt-1 max-w-2xl text-pretty">
                                            Drop a PDF to auto-fill catalog metadata, render a Page 1 cover, and screen for copyright & piracy notices.
                                            You’ll review and publish it on the next screen once everything is verified.
                                        </CardDescription>
                                    </div>
                                </div>

                                {form.data.digital_pdf && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="gap-1.5 rounded-xl"
                                            onClick={() => setMetadataModalOpen(true)}
                                            data-testid="open-pdf-metadata-modal"
                                        >
                                            <Wand2 className="size-3.5" />
                                            Attach / Edit PDF Metadata
                                        </Button>
                                        {pageOneCoverPreview && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={pageOneCoverApplied ? "secondary" : "outline"}
                                                className="gap-1.5 rounded-xl"
                                                onClick={applyPageOneAsCover}
                                                data-testid="use-page1-cover"
                                            >
                                                {pageOneCoverApplied ? (
                                                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                                                ) : (
                                                    <ImageIcon className="size-3.5" />
                                                )}
                                                {pageOneCoverApplied ? "Page 1 cover set" : "Use Page 1 as Cover"}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </CardHeader>

                        <CardContent className="space-y-4 p-5 sm:p-6">
                            <div className="space-y-2">
                                <label
                                    htmlFor="create_digital_pdf"
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        setDragActive(true);
                                    }}
                                    onDragLeave={() => setDragActive(false)}
                                    onDrop={handleDropPdf}
                                    className={cn(
                                        "cursor-pointer rounded-2xl border border-dashed transition-colors",
                                        form.data.digital_pdf
                                            ? "flex flex-col gap-3 px-4 py-3.5 text-left sm:flex-row sm:items-center sm:justify-between"
                                            : "flex flex-col items-center justify-center gap-3 p-7 text-center",
                                        dragActive
                                            ? "border-sky-600 bg-sky-500/10"
                                            : "border-border hover:border-sky-500/60 hover:bg-muted/30",
                                    )}
                                >
                                    <div className={cn("flex items-center gap-3", !form.data.digital_pdf && "flex-col")}>
                                        <div
                                            className={cn(
                                                "flex shrink-0 items-center justify-center rounded-xl bg-sky-600/10 text-sky-700 dark:text-sky-300",
                                                form.data.digital_pdf ? "size-10" : "size-12 rounded-2xl",
                                            )}
                                        >
                                            {inspectingPdf ? (
                                                <Loader2 className={cn(form.data.digital_pdf ? "size-5" : "size-6", "animate-spin")} />
                                            ) : form.data.digital_pdf ? (
                                                <FileText className="size-5" />
                                            ) : (
                                                <UploadCloud className="size-6" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold">
                                                {inspectingPdf
                                                    ? "Inspecting PDF metadata & copyright notices…"
                                                    : form.data.digital_pdf
                                                      ? form.data.digital_pdf.name
                                                      : "Drop an eBook PDF here, or click to browse"}
                                            </p>
                                            <p className="text-muted-foreground mt-0.5 text-xs">
                                                {form.data.digital_pdf
                                                    ? `${formatBytes(form.data.digital_pdf.size)} · Saved privately as Draft until published`
                                                    : "PDF only, up to 90 MB · Stored privately as Draft with downloads disabled until reviewed"}
                                            </p>
                                        </div>
                                    </div>
                                    {form.data.digital_pdf && (
                                        <span className="border-border bg-background inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border px-3 py-1.5 text-xs font-medium shadow-2xs sm:self-center">
                                            <UploadCloud className="size-3.5" />
                                            Replace PDF
                                        </span>
                                    )}
                                </label>
                                <Input
                                    ref={createPdfInputRef}
                                    id="create_digital_pdf"
                                    type="file"
                                    accept=".pdf,application/pdf"
                                    className="sr-only"
                                    onChange={(event) => void handleCreatePdfSelection(event.target.files?.[0] ?? null)}
                                />
                                {(bookError("digital_pdf") || pdfInspectError) && (
                                    <p className="text-destructive text-sm">{bookError("digital_pdf") ?? pdfInspectError}</p>
                                )}
                            </div>

                            {/* Metadata status banner — reflects live form completion */}
                            {pdfInspection && (
                                <div
                                    className={cn(
                                        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs",
                                        remainingMissingMetadataCount === 0
                                            ? "border-emerald-600/25 bg-emerald-50/70 dark:bg-emerald-950/15"
                                            : "bg-muted/35",
                                    )}
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        {remainingMissingMetadataCount === 0 ? (
                                            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                        ) : (
                                            <Sparkles className="text-primary size-4 shrink-0" />
                                        )}
                                        <span className="font-medium">
                                            {remainingMissingMetadataCount === 0
                                                ? "Core catalog metadata complete and ready for Draft"
                                                : `${remainingMissingMetadataCount} catalog metadata field${remainingMissingMetadataCount === 1 ? "" : "s"} still empty`}
                                        </span>
                                        {pdfInspection.metadata.pages && (
                                            <Badge variant="outline" className="text-[11px] tabular-nums">
                                                {pdfInspection.metadata.pages}{" "}
                                                {pdfInspection.metadata.pages === 1 ? "page" : "pages"}
                                            </Badge>
                                        )}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1 px-2 text-xs"
                                        onClick={() => setMetadataModalOpen(true)}
                                    >
                                        <Wand2 className="size-3" />
                                        {remainingMissingMetadataCount === 0 ? "Edit metadata" : "Complete metadata"}
                                    </Button>
                                </div>
                            )}

                            {/* Automated Copyright Screening Panel */}
                            {pdfInspection && (
                                <CopyrightScanPanel
                                    scan={pdfInspection.rights_scan}
                                    publicationYear={parsedPublicationYear}
                                    selectedRightsBasis={form.data.digital_rights_basis || null}
                                    mode="create"
                                    onAutoFillLicense={handleCreateAutoFillLicense}
                                    onApplySafeDefaults={handleCreateApplySafeDefaults}
                                    onReplacePdf={() => createPdfInputRef.current?.click()}
                                    onDiscardOrConvertToPhysical={handleCreateDiscardPdf}
                                />
                            )}

                            {/* Optional Pre-fill Draft Rights Documentation */}
                            {form.data.digital_pdf && !pdfInspection?.rights_scan.piracy_blocked && (
                                <div className="rounded-xl border">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateRightsPanel((open) => !open)}
                                        className="hover:bg-muted/30 flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition-colors"
                                    >
                                        <span className="flex items-center gap-2">
                                            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                                            Pre-fill Draft rights documentation (optional)
                                        </span>
                                        {showCreateRightsPanel ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                    </button>
                                    {showCreateRightsPanel && (
                                        <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label>Rights basis</Label>
                                                <Select
                                                    value={form.data.digital_rights_basis || undefined}
                                                    onValueChange={(value) => form.setData("digital_rights_basis", value)}
                                                >
                                                    <SelectTrigger className="h-10 rounded-xl">
                                                        <SelectValue placeholder="Select documented rights" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {options.digital_rights_bases.map((basis) => (
                                                            <SelectItem key={basis.value} value={String(basis.value)}>
                                                                {basis.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-1.5">
                                                <Label htmlFor="create_digital_rights_holder">Rights holder</Label>
                                                <Input
                                                    id="create_digital_rights_holder"
                                                    value={form.data.digital_rights_holder}
                                                    onChange={(event) => form.setData("digital_rights_holder", event.target.value)}
                                                    placeholder="Author, publisher, or KoAkademy"
                                                    className="h-10 rounded-xl"
                                                />
                                            </div>

                                            <div className="space-y-1.5 sm:col-span-2">
                                                <Label htmlFor="create_digital_license_url">License or permission URL</Label>
                                                <Input
                                                    id="create_digital_license_url"
                                                    type="url"
                                                    value={form.data.digital_license_url}
                                                    onChange={(event) => form.setData("digital_license_url", event.target.value)}
                                                    placeholder="https://creativecommons.org/licenses/…"
                                                    className="h-10 rounded-xl"
                                                />
                                                {bookError("digital_license_url") && (
                                                    <p className="text-destructive text-xs">{bookError("digital_license_url")}</p>
                                                )}
                                            </div>

                                            <div className="space-y-1.5 sm:col-span-2">
                                                <Label htmlFor="create_digital_rights_notes">Rights and permission notes</Label>
                                                <Textarea
                                                    ref={createRightsNotesRef}
                                                    id="create_digital_rights_notes"
                                                    rows={3}
                                                    value={form.data.digital_rights_notes}
                                                    onChange={(event) => form.setData("digital_rights_notes", event.target.value)}
                                                    placeholder="Record permission source, institutional license, or OER verification notes…"
                                                    className="rounded-xl"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* ── Catalog Details & Inventory/Cover Grid ── */}
                <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
                    <Card className="overflow-hidden rounded-2xl pt-0 shadow-xs">
                        <CardHeader className="bg-muted/25 border-b pt-5 pb-4">
                            <div className="flex items-start gap-3">
                                <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
                                    {identityStepNumber}
                                </span>
                                <div>
                                    <CardTitle>Identity and classification</CardTitle>
                                    <CardDescription className="text-pretty">
                                        {isEbookOnly
                                            ? "Enter core bibliographic metadata so readers can discover this eBook in the public library."
                                            : "Start with the searchable relationships, then reuse or enter catalog identifiers."}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="grid gap-5 sm:grid-cols-2">
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="title">Title</Label>
                                <Input
                                    id="title"
                                    value={form.data.title}
                                    onChange={(event) => form.setData("title", event.target.value)}
                                    placeholder="Enter the title as it appears on the book"
                                    className="h-11 rounded-xl"
                                    autoFocus={!book && !supportsDigital}
                                    aria-invalid={Boolean(bookError("title"))}
                                />
                                {bookError("title") && (
                                    <p id="title-error" className="text-destructive text-xs">
                                        {bookError("title")}
                                    </p>
                                )}
                            </div>

                            <CatalogRelationField
                                id="author_id"
                                kind="author"
                                options={authorOptions}
                                value={form.data.author_id}
                                onValueChange={(value) => form.setData("author_id", value)}
                                onOptionCreated={registerAuthorOption}
                                error={bookError("author_id") ?? undefined}
                            />

                            <CatalogRelationField
                                id="category_id"
                                kind="category"
                                options={categoryOptions}
                                value={form.data.category_id}
                                onValueChange={(value) => form.setData("category_id", value)}
                                onOptionCreated={registerCategoryOption}
                                error={bookError("category_id") ?? undefined}
                            />

                            <CatalogIdentifierField
                                id="isbn"
                                kind="isbn"
                                value={form.data.isbn}
                                onValueChange={(value) => form.setData("isbn", value)}
                                error={bookError("isbn") ?? undefined}
                            />

                            {!isEbookOnly && (
                                <>
                                    <CatalogIdentifierField
                                        id="call_number"
                                        kind="call_number"
                                        value={form.data.call_number}
                                        onValueChange={(value) => form.setData("call_number", value)}
                                        error={bookError("call_number") ?? undefined}
                                    />

                                    <div className="space-y-2">
                                        <Label htmlFor="accession_number">Accession Number</Label>
                                        <Input
                                            id="accession_number"
                                            value={form.data.accession_number}
                                            onChange={(event) => form.setData("accession_number", event.target.value)}
                                            placeholder="Copy-specific accession code"
                                            className="h-11 rounded-xl"
                                            aria-invalid={Boolean(bookError("accession_number"))}
                                        />
                                        <p className="text-muted-foreground text-xs text-pretty">
                                            Use a unique code for this physical catalog record.
                                        </p>
                                        {bookError("accession_number") && (
                                            <p className="text-destructive text-xs">{bookError("accession_number")}</p>
                                        )}
                                    </div>
                                </>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="publisher">Publisher</Label>
                                <Input
                                    id="publisher"
                                    value={form.data.publisher}
                                    onChange={(event) => form.setData("publisher", event.target.value)}
                                    placeholder="Publisher name"
                                    className="h-11 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="publication_year">Publication Year</Label>
                                <Input
                                    id="publication_year"
                                    type="number"
                                    value={form.data.publication_year}
                                    onChange={(event) => form.setData("publication_year", event.target.value)}
                                    placeholder="YYYY"
                                    className="h-11 rounded-xl"
                                    aria-invalid={Boolean(bookError("publication_year"))}
                                />
                                {bookError("publication_year") && <p className="text-destructive text-xs">{bookError("publication_year")}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="pages">Pages</Label>
                                <Input
                                    id="pages"
                                    type="number"
                                    value={form.data.pages}
                                    onChange={(event) => form.setData("pages", event.target.value)}
                                    placeholder="Number of pages"
                                    className="h-11 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    rows={4}
                                    value={form.data.description}
                                    onChange={(event) => form.setData("description", event.target.value)}
                                    placeholder="Optional summary or catalog notes"
                                    className="rounded-xl"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex flex-col gap-6">
                        <Card className="overflow-hidden rounded-2xl pt-0 shadow-xs">
                            <CardHeader className="bg-muted/25 border-b pt-5 pb-4">
                                <div className="flex items-start gap-3">
                                    <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
                                        {sidebarStepNumber}
                                    </span>
                                    <div>
                                        <CardTitle>{isEbookOnly ? "Cover image" : "Inventory and cover"}</CardTitle>
                                        <CardDescription className="text-pretty">
                                            {isEbookOnly
                                                ? "Physical copies and shelf fields are hidden for digital-only eBooks."
                                                : "Set ready-to-use copy defaults and shelf information."}
                                        </CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                {!isEbookOnly && (
                                    <>
                                        <div className="space-y-2">
                                            <Label htmlFor="total_copies">Total Copies</Label>
                                            <Input
                                                id="total_copies"
                                                type="number"
                                                value={form.data.total_copies}
                                                onChange={(event) => handleTotalCopiesChange(event.target.value)}
                                                className="h-10 rounded-xl tabular-nums"
                                                aria-invalid={Boolean(bookError("total_copies"))}
                                            />
                                            {bookError("total_copies") && <p className="text-destructive text-xs">{bookError("total_copies")}</p>}
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="available_copies">Available Copies</Label>
                                            <Input
                                                id="available_copies"
                                                type="number"
                                                value={form.data.available_copies}
                                                onChange={(event) => form.setData("available_copies", event.target.value)}
                                                className="h-10 rounded-xl tabular-nums"
                                                aria-invalid={Boolean(bookError("available_copies"))}
                                            />
                                            {bookError("available_copies") && (
                                                <p className="text-destructive text-xs">{bookError("available_copies")}</p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="location">Shelf Location</Label>
                                            <Input
                                                id="location"
                                                value={form.data.location}
                                                onChange={(event) => form.setData("location", event.target.value)}
                                                placeholder="e.g. Main Library · A-12"
                                                className="h-10 rounded-xl"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="status">Status</Label>
                                            <Select value={form.data.status} onValueChange={(value) => form.setData("status", value)}>
                                                <SelectTrigger
                                                    id="status"
                                                    className="h-10 rounded-xl"
                                                    aria-invalid={Boolean(bookError("status"))}
                                                >
                                                    <SelectValue placeholder="Select status" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {options.statuses.map((status) => (
                                                        <SelectItem key={status.value} value={String(status.value)}>
                                                            {status.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            {bookError("status") && <p className="text-destructive text-xs">{bookError("status")}</p>}
                                        </div>
                                    </>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="cover_image">Cover Image URL</Label>
                                    <Input
                                        id="cover_image"
                                        value={form.data.cover_image}
                                        onChange={(event) => form.setData("cover_image", event.target.value)}
                                        placeholder="https://…"
                                        className="h-10 rounded-xl"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="cover_image_upload">Cover Image Upload</Label>
                                    <Input
                                        id="cover_image_upload"
                                        type="file"
                                        accept="image/*"
                                        className="h-10 rounded-xl"
                                        aria-invalid={Boolean(bookError("cover_image_upload"))}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0] || null;
                                            form.setData("cover_image_upload", file);
                                            setCoverUploadPreview(file ? URL.createObjectURL(file) : null);
                                            setPageOneCoverApplied(false);
                                        }}
                                    />
                                    {bookError("cover_image_upload") && (
                                        <p className="text-destructive text-xs">{bookError("cover_image_upload")}</p>
                                    )}
                                </div>
                                {pageOneCoverPreview && !pageOneCoverApplied && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5 rounded-xl"
                                        onClick={applyPageOneAsCover}
                                    >
                                        <ImageIcon className="size-3.5" />
                                        Use PDF Page 1 as Cover
                                    </Button>
                                )}
                                {coverPreview && (
                                    <div className="bg-muted/40 overflow-hidden rounded-xl p-2">
                                        <img
                                            src={coverPreview}
                                            alt="Book cover preview"
                                            className="bg-background h-52 w-full rounded-lg object-contain outline -outline-offset-1 outline-black/10 dark:outline-white/10"
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl shadow-xs">
                            <CardHeader>
                                <CardTitle>{isEbookOnly ? "Draft-first publishing workflow" : "Fast-entry checklist"}</CardTitle>
                                <CardDescription>
                                    {isEbookOnly
                                        ? "How KoAkademy keeps hosted PDFs clean, searchable, and legally safe."
                                        : "Small choices that keep the catalog easy to search."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                {(isEbookOnly
                                    ? [
                                          "Every newly uploaded eBook is saved as a Draft first with downloads disabled.",
                                          "Files from known piracy sites are automatically blocked from publishing.",
                                          "After saving, review the copyright screening and confirm rights to publish for open reading.",
                                      ]
                                    : [
                                          "Reuse an existing ISBN or call number when the catalog already has it.",
                                          "Quick-add missing authors and categories without abandoning this form.",
                                          "Add a shelf location so staff can retrieve the book immediately.",
                                      ]
                                ).map((tip) => (
                                    <div key={tip} className="text-muted-foreground flex items-start gap-2.5">
                                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                        <p className="text-pretty">{tip}</p>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </form>

            {!book && (
                <PdfMetadataModal
                    open={metadataModalOpen}
                    onOpenChange={setMetadataModalOpen}
                    fileName={form.data.digital_pdf?.name ?? null}
                    inspection={pdfInspection}
                    currentValues={{
                        title: form.data.title,
                        author_id: form.data.author_id,
                        category_id: form.data.category_id,
                        publisher: form.data.publisher,
                        publication_year: form.data.publication_year,
                        isbn: form.data.isbn,
                        pages: form.data.pages,
                        description: form.data.description,
                    }}
                    authorOptions={authorOptions}
                    categoryOptions={categoryOptions}
                    onAuthorCreated={registerAuthorOption}
                    onCategoryCreated={registerCategoryOption}
                    pageOneCoverPreview={pageOneCoverPreview}
                    renderingCover={renderingCover}
                    coverApplied={pageOneCoverApplied}
                    onApplyPageOneCover={applyPageOneAsCover}
                    onApplyMetadata={applyMetadataFromModal}
                />
            )}

            {book && <DigitalEditionSection book={book} rightsBases={options.digital_rights_bases} />}
        </AdminLayout>
    );
}

interface DigitalEditionFormData {
    pdf: File | null;
    status: "draft" | "published";
    downloads_allowed: boolean;
    rights_basis: string;
    rights_holder: string;
    license_url: string;
    rights_notes: string;
    rights_expires_at: string;
    rights_confirmed: boolean;
}

function DigitalEditionSection({ book, rightsBases }: { book: BookRecord; rightsBases: CatalogOption[] }) {
    const edition = book.digital_edition;
    const form = useForm<DigitalEditionFormData>({
        pdf: null,
        status: edition?.is_piracy_blocked ? "draft" : (edition?.status ?? "draft"),
        downloads_allowed: edition?.downloads_allowed ?? false,
        rights_basis: edition?.rights_basis ?? "",
        rights_holder: edition?.rights_holder ?? "",
        license_url: edition?.license_url ?? "",
        rights_notes: edition?.rights_notes ?? "",
        rights_expires_at: edition?.rights_expires_at ?? "",
        rights_confirmed: false,
    });

    const [inspectingReplacement, setInspectingReplacement] = useState(false);
    const [pendingScan, setPendingScan] = useState<RightsScanResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const rightsNotesRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        form.setData({
            pdf: null,
            status: edition?.is_piracy_blocked ? "draft" : (edition?.status ?? "draft"),
            downloads_allowed: edition?.downloads_allowed ?? false,
            rights_basis: edition?.rights_basis ?? "",
            rights_holder: edition?.rights_holder ?? "",
            license_url: edition?.license_url ?? "",
            rights_notes: edition?.rights_notes ?? "",
            rights_expires_at: edition?.rights_expires_at ?? "",
            rights_confirmed: false,
        });
        setPendingScan(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [edition?.id, edition?.uploaded_at, edition?.status, edition?.is_piracy_blocked]);

    if (!book.can_manage_digital_edition) {
        return edition ? (
            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Digital Edition</CardTitle>
                    <CardDescription>A digital edition exists, but your account cannot change its publication settings.</CardDescription>
                </CardHeader>
            </Card>
        ) : null;
    }

    const activeScan = form.data.pdf ? pendingScan : (edition?.rights_scan ?? null);
    const piracyBlocked = Boolean(form.data.pdf ? pendingScan?.piracy_blocked : edition?.is_piracy_blocked);

    const handleReplacementFileChange = async (file: File | null) => {
        form.setData("pdf", file);
        setPendingScan(null);

        if (!file) return;

        setInspectingReplacement(true);
        try {
            const result = await requestPdfInspection(file);
            setPendingScan(result.rights_scan);
            if (result.rights_scan.piracy_blocked) {
                toast.error("Piracy source watermark detected in this replacement PDF.", {
                    description: "Choose a different rights-cleared file before uploading.",
                });
            }
        } catch {
            // Server will still screen authoritatively on upload
        } finally {
            setInspectingReplacement(false);
        }
    };

    const handleAutoFillLicense = (suggested: SuggestedRights) => {
        if (suggested.rights_basis) {
            form.setData("rights_basis", suggested.rights_basis);
        }
        if (suggested.rights_holder) {
            form.setData("rights_holder", suggested.rights_holder);
        }
        if (suggested.license_url) {
            form.setData("license_url", suggested.license_url);
        }
        toast.success("Detected open-license fields filled in. Review them and save when ready.");
    };

    const handleApplySafeDefaults = (scan: RightsScanResult) => {
        form.setData("status", "draft");
        form.setData("downloads_allowed", false);
        if (!form.data.rights_basis || form.data.rights_basis === "public_domain") {
            form.setData("rights_basis", "written_permission");
        }
        if (!form.data.rights_holder && scan.suggested_rights.rights_holder) {
            form.setData("rights_holder", scan.suggested_rights.rights_holder);
        }
        const memo = buildSafePermissionMemo(scan);
        if (!form.data.rights_notes.includes("[Automated Copyright Screening")) {
            form.setData("rights_notes", form.data.rights_notes ? `${form.data.rights_notes}\n\n${memo}` : memo);
        }
        toast.info("Safe draft defaults applied. Document your written permission below before publishing.");
        window.setTimeout(() => {
            rightsNotesRef.current?.focus();
            rightsNotesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 60);
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();

        if (form.data.pdf) {
            form.transform((data) => ({
                ...data,
                status: "draft",
                downloads_allowed: false,
                rights_confirmed: false,
            }));
            form.post(storeDigitalEdition.url(book.id), {
                errorBag: "digitalEdition",
                forceFormData: true,
                preserveScroll: true,
                onSuccess: () => {
                    form.setData("pdf", null);
                    setPendingScan(null);
                    if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                    }
                },
            });
            return;
        }

        if (edition) {
            form.put(updateDigitalEdition.url(book.id), {
                errorBag: "digitalEdition",
                preserveScroll: true,
            });
        }
    };

    const removeEdition = () => {
        if (!window.confirm(`Remove the digital edition of “${book.title}”? This cannot be undone.`)) return;

        router.delete(destroyDigitalEdition.url(book.id), {
            preserveScroll: true,
        });
    };

    const copyReaderLink = async () => {
        const relativeUrl = readDigitalBook.url(book.id);
        const absoluteUrl = typeof window !== "undefined" ? new URL(relativeUrl, window.location.origin).toString() : relativeUrl;

        try {
            await navigator.clipboard.writeText(absoluteUrl);
            toast.success("Public reader link copied to clipboard.");
        } catch {
            toast.error("Could not copy link automatically.", {
                description: absoluteUrl,
            });
        }
    };

    const publishing = form.data.status === "published" && !form.data.pdf && !piracyBlocked;

    return (
        <form id="digital-edition" onSubmit={handleSubmit} className="mt-6 scroll-mt-20">
            <Card className={cn("overflow-hidden rounded-2xl pt-0 shadow-xs", piracyBlocked ? "border-rose-600/40" : "border-amber-700/20")}>
                <CardHeader
                    className={cn(
                        "border-b pt-5 pb-4",
                        piracyBlocked ? "bg-rose-50/80 dark:bg-rose-950/20" : "bg-amber-50/70 dark:bg-amber-950/10",
                    )}
                >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 gap-3">
                            <div
                                className={cn(
                                    "flex size-11 shrink-0 items-center justify-center rounded-xl",
                                    piracyBlocked
                                        ? "bg-rose-600 text-white"
                                        : "bg-amber-700/10 text-amber-700 dark:text-amber-300",
                                )}
                            >
                                {piracyBlocked ? <ShieldBan className="size-5" /> : <BookOpen className="size-5" />}
                            </div>
                            <div className="min-w-0 max-w-2xl">
                                <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle>Digital Edition</CardTitle>
                                    {piracyBlocked ? (
                                        <Badge className="bg-rose-600 text-white hover:bg-rose-600">Blocked · Piracy Source</Badge>
                                    ) : (
                                        <Badge variant={edition?.status === "published" ? "default" : "secondary"}>
                                            {edition?.status === "published" ? "Published" : edition ? "Draft" : "Not uploaded"}
                                        </Badge>
                                    )}
                                </div>
                                <CardDescription className="mt-1 text-pretty">
                                    Upload a rights-cleared PDF for open browser reading without an account. New files default to draft, and PDF
                                    downloads require a signed-in account and stay off unless explicitly allowed.
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {edition?.status === "published" && !edition.is_piracy_blocked && (
                                <>
                                    <Button type="button" variant="outline" className="gap-2" onClick={() => void copyReaderLink()}>
                                        <Copy className="size-4" />
                                        Copy reader link
                                    </Button>
                                    <Link
                                        href={readDigitalBook.url(book.id)}
                                        className={buttonVariants({ variant: "outline", className: "gap-2" })}
                                    >
                                        <BookOpen className="size-4" />
                                        Preview reader
                                    </Link>
                                </>
                            )}
                            {edition && (
                                <Button type="button" variant="destructive" className="gap-2" onClick={removeEdition}>
                                    <Trash2 className="size-4" />
                                    Remove edition
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="grid gap-7 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)] lg:p-6">
                    <div className="min-w-0 space-y-6">
                        {activeScan && (
                            <CopyrightScanPanel
                                scan={activeScan}
                                publicationYear={book.publication_year}
                                selectedRightsBasis={form.data.rights_basis || null}
                                mode="edit"
                                onAutoFillLicense={handleAutoFillLicense}
                                onApplySafeDefaults={handleApplySafeDefaults}
                                onReplacePdf={() => fileInputRef.current?.click()}
                                onDiscardOrConvertToPhysical={edition ? removeEdition : undefined}
                            />
                        )}

                        <div className="relative space-y-3">
                            <Label htmlFor="digital_pdf">{edition ? "Replace PDF" : "PDF file"}</Label>
                            <label
                                htmlFor="digital_pdf"
                                className="border-border hover:border-primary/50 hover:bg-muted/30 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center transition-colors"
                            >
                                <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
                                    {inspectingReplacement ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
                                </div>
                                <div>
                                    <p className="font-medium">
                                        {inspectingReplacement
                                            ? "Screening replacement PDF…"
                                            : form.data.pdf
                                              ? form.data.pdf.name
                                              : edition
                                                ? "Choose a replacement PDF"
                                                : "Choose a PDF to upload"}
                                    </p>
                                    <p className="text-muted-foreground mt-1 text-xs">
                                        PDF only, up to 90 MB. Files are stored privately and always saved as Draft first.
                                    </p>
                                </div>
                            </label>
                            <Input
                                ref={fileInputRef}
                                id="digital_pdf"
                                type="file"
                                accept=".pdf,application/pdf"
                                className="sr-only"
                                onChange={(event) => void handleReplacementFileChange(event.target.files?.[0] ?? null)}
                            />
                            {form.errors.pdf && <p className="text-destructive text-sm">{form.errors.pdf}</p>}
                        </div>

                        {edition && (
                            <div className="bg-muted/35 grid gap-3 rounded-2xl border p-4 sm:grid-cols-3">
                                <FileMetric icon={FileText} label="Current file" value={edition.original_name} />
                                <FileMetric icon={Download} label="File size" value={formatBytes(edition.size_bytes)} />
                                <FileMetric
                                    icon={FileCheck2}
                                    label="Uploaded"
                                    value={edition.uploaded_at ? new Date(edition.uploaded_at).toLocaleDateString() : "Unknown"}
                                />
                            </div>
                        )}

                        <div className="grid gap-5 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Publication status</Label>
                                <Select
                                    disabled={Boolean(form.data.pdf) || !edition || piracyBlocked}
                                    value={form.data.pdf || !edition || piracyBlocked ? "draft" : form.data.status}
                                    onValueChange={(value) => form.setData("status", value as "draft" | "published")}
                                >
                                    <SelectTrigger data-testid="digital-status-select">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="draft">Draft — staff only</SelectItem>
                                        <SelectItem value="published" disabled={piracyBlocked}>
                                            Published — public browser reading
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                {piracyBlocked ? (
                                    <p className="text-destructive text-xs leading-5">
                                        Publishing is blocked because a known piracy-site watermark was detected. Replace this file with a
                                        rights-cleared PDF or remove the edition.
                                    </p>
                                ) : (form.data.pdf || !edition) && (
                                    <p className="text-muted-foreground text-xs leading-5">
                                        Every new or replacement file is saved as a draft. Publish it in a separate reviewed step after the upload
                                        completes.
                                    </p>
                                )}
                                {form.errors.status && <p className="text-destructive text-sm">{form.errors.status}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label>Rights basis</Label>
                                <Select value={form.data.rights_basis || undefined} onValueChange={(value) => form.setData("rights_basis", value)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select documented rights" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {rightsBases.map((basis) => (
                                            <SelectItem key={basis.value} value={String(basis.value)}>
                                                {basis.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {form.errors.rights_basis && <p className="text-destructive text-sm">{form.errors.rights_basis}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="rights_holder">Rights holder</Label>
                                <Input
                                    id="rights_holder"
                                    value={form.data.rights_holder}
                                    onChange={(event) => form.setData("rights_holder", event.target.value)}
                                    placeholder="Author, publisher, or KoAkademy"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="license_url">License or permission URL</Label>
                                <Input
                                    id="license_url"
                                    type="url"
                                    value={form.data.license_url}
                                    onChange={(event) => form.setData("license_url", event.target.value)}
                                    placeholder="https://…"
                                />
                                {form.errors.license_url && <p className="text-destructive text-sm">{form.errors.license_url}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="rights_expires_at">Rights expiration</Label>
                                <Input
                                    id="rights_expires_at"
                                    type="date"
                                    value={form.data.rights_expires_at}
                                    onChange={(event) => form.setData("rights_expires_at", event.target.value)}
                                />
                                <p className="text-muted-foreground text-xs">Leave blank when rights do not expire.</p>
                            </div>

                            <div className="flex items-start gap-3 rounded-xl border p-4">
                                <Checkbox
                                    id="downloads_allowed"
                                    disabled={piracyBlocked}
                                    checked={piracyBlocked ? false : form.data.downloads_allowed}
                                    onCheckedChange={(checked) => form.setData("downloads_allowed", checked === true)}
                                />
                                <div>
                                    <Label htmlFor="downloads_allowed">Allow PDF downloads (account required)</Label>
                                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                                        Keep disabled unless documented rights permit downloads. Only signed-in users can download when enabled.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="rights_notes">Rights and review notes</Label>
                                <Textarea
                                    ref={rightsNotesRef}
                                    id="rights_notes"
                                    rows={4}
                                    value={form.data.rights_notes}
                                    onChange={(event) => form.setData("rights_notes", event.target.value)}
                                    placeholder="Record the permission source, license limits, librarian review, or takedown considerations."
                                />
                                {form.errors.rights_notes && <p className="text-destructive text-sm">{form.errors.rights_notes}</p>}
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0 space-y-5 lg:sticky lg:top-6 lg:self-start">
                        <div className="rounded-2xl border border-amber-700/20 bg-amber-50/70 p-5 dark:bg-amber-950/10">
                            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
                                <ShieldCheck className="size-5" />
                                <h3 className="font-serif text-lg font-semibold">Publication attestation</h3>
                            </div>
                            <div className="text-muted-foreground mt-3 space-y-3 text-sm leading-6">
                                <p>Only publish files that KoAkademy owns or is authorized to reproduce and communicate digitally.</p>
                                <p>
                                    Physical ownership, educational purpose, or disabling the download button does not itself grant digital
                                    distribution rights.
                                </p>
                            </div>
                            {publishing && (
                                <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-800/20 bg-white/60 p-4 dark:bg-black/20">
                                    <Checkbox
                                        id="rights_confirmed"
                                        checked={form.data.rights_confirmed}
                                        onCheckedChange={(checked) => form.setData("rights_confirmed", checked === true)}
                                    />
                                    <Label htmlFor="rights_confirmed" className="text-sm leading-6">
                                        I reviewed the documentation and confirm KoAkademy has the right to publish this PDF for online reading
                                        under the selected terms.
                                    </Label>
                                </div>
                            )}
                            {form.errors.rights_confirmed && <p className="text-destructive mt-2 text-sm">{form.errors.rights_confirmed}</p>}
                        </div>

                        <Button
                            type="submit"
                            className="w-full gap-2"
                            size="lg"
                            disabled={form.processing || (!edition && !form.data.pdf)}
                            data-testid="digital-edition-submit"
                        >
                            <Save className="size-4" />
                            {form.processing
                                ? "Saving digital edition…"
                                : form.data.pdf
                                  ? edition
                                      ? "Replace PDF as draft"
                                      : "Upload PDF as draft"
                                  : "Save publication settings"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </form>
    );
}

function FileMetric({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
    return (
        <div className="flex min-w-0 gap-2">
            <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">{label}</p>
                <p className="mt-1 truncate text-sm font-medium" title={value}>
                    {value}
                </p>
            </div>
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
