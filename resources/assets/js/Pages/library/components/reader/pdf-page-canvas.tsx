import { cn } from "@/lib/utils";
import { LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

export type ReaderFitMode = "width" | "page" | "manual";
export type ReaderSurfaceTheme = "paper" | "sepia" | "dark";

interface PdfPageCanvasProps {
    document: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
    fitMode: ReaderFitMode;
    surfaceTheme: ReaderSurfaceTheme;
    containerWidth: number;
    containerHeight: number;
    lazy?: boolean;
    onBecomeVisible?: (pageNumber: number) => void;
}

export function PdfPageCanvas({
    document,
    pageNumber,
    zoom,
    fitMode,
    surfaceTheme,
    containerWidth,
    containerHeight,
    lazy = false,
    onBecomeVisible,
}: PdfPageCanvasProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<RenderTask | null>(null);
    const [shouldRender, setShouldRender] = useState(!lazy);
    const [rendering, setRendering] = useState(true);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
        width: Math.min(820, Math.max(280, containerWidth)),
        height: Math.round(Math.min(820, Math.max(280, containerWidth)) * 1.33),
    });

    useEffect(() => {
        if (!lazy || !wrapperRef.current) return;

        const renderObserver = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShouldRender(true);
                }
            },
            { rootMargin: "700px 0px" },
        );

        renderObserver.observe(wrapperRef.current);

        return () => renderObserver.disconnect();
    }, [lazy]);

    useEffect(() => {
        if (!onBecomeVisible || !wrapperRef.current) return;

        const activeObserver = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
                    onBecomeVisible(pageNumber);
                }
            },
            { threshold: [0.45, 0.65] },
        );

        activeObserver.observe(wrapperRef.current);

        return () => activeObserver.disconnect();
    }, [onBecomeVisible, pageNumber]);

    useEffect(() => {
        if (!shouldRender) return;

        let cancelled = false;
        setRendering(true);

        void document.getPage(pageNumber).then(async (page) => {
            if (cancelled || !canvasRef.current) return;
            renderTaskRef.current?.cancel();

            const baseViewport = page.getViewport({ scale: 1 });
            const availableWidth = Math.max(260, containerWidth);
            const availableHeight = Math.max(320, containerHeight);

            const widthScale = Math.min(2.2, availableWidth / baseViewport.width);
            const pageScale = Math.min(widthScale, availableHeight / baseViewport.height);

            const cssScale =
                fitMode === "page"
                    ? pageScale * zoom
                    : fitMode === "width"
                      ? widthScale * zoom
                      : Math.min(2.4, Math.max(0.5, zoom * Math.min(1.25, availableWidth / baseViewport.width)));

            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            const cssWidth = Math.floor(baseViewport.width * cssScale);
            const cssHeight = Math.floor(baseViewport.height * cssScale);
            setDimensions({ width: cssWidth, height: cssHeight });

            const viewport = page.getViewport({ scale: cssScale * pixelRatio });
            const canvas = canvasRef.current;
            const context = canvas.getContext("2d");
            if (!context) return;

            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;

            const task = page.render({ canvas, canvasContext: context, viewport });
            renderTaskRef.current = task;

            try {
                await task.promise;
                if (!cancelled) setRendering(false);
            } catch (renderError) {
                if ((renderError as Error).name !== "RenderingCancelledException") {
                    throw renderError;
                }
            }
        });

        return () => {
            cancelled = true;
            renderTaskRef.current?.cancel();
        };
    }, [containerHeight, containerWidth, document, fitMode, pageNumber, shouldRender, zoom]);

    const surfaceFilterClass =
        surfaceTheme === "sepia"
            ? "sepia-[0.22] contrast-[0.96] brightness-[0.98]"
            : surfaceTheme === "dark"
              ? "invert-[0.88] hue-rotate-180 contrast-[0.92] brightness-[0.95]"
              : "";

    return (
        <div
            ref={wrapperRef}
            data-page-number={pageNumber}
            className="relative flex shrink-0 flex-col items-center"
            style={{ minWidth: dimensions.width, minHeight: dimensions.height }}
        >
            <div
                className={cn(
                    "relative overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-black/10 dark:ring-white/10",
                    surfaceTheme === "dark" && "bg-zinc-900 shadow-black/50",
                )}
            >
                <canvas
                    ref={canvasRef}
                    className={cn("block bg-white transition-[filter] duration-150", surfaceFilterClass)}
                    aria-label={`Page ${pageNumber}`}
                />
                {rendering && (
                    <div className="bg-muted/40 absolute inset-0 flex items-center justify-center backdrop-blur-[1px]">
                        <LoaderCircle className="text-muted-foreground size-6 animate-spin" />
                    </div>
                )}
            </div>
            {lazy && (
                <span className="text-muted-foreground mt-2 text-[11px] font-medium tabular-nums">
                    Page {pageNumber}
                </span>
            )}
        </div>
    );
}
