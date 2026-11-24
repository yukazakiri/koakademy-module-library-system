import AdminLayout from "@/components/administrators/admin-layout";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { create as createBook } from "@/routes/administrators/library/books";
import { index as publicLibraryIndex } from "@/routes/library";
import type { User } from "@/types/user";
import { Head, Link, router } from "@inertiajs/react";
import { BookOpen, ExternalLink, FileText, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { columns, type Book } from "./columns";
import { DataTable } from "./data-table";

declare const route: any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface PaginationInfo {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    next_page_url: string | null;
    prev_page_url: string | null;
    from: number;
    to: number;
}

interface Props {
    user: User;
    books: {
        data: Book[];
    } & PaginationInfo;
    stats: {
        total_books: number;
        available_copies: number;
        borrowed_books: number;
        published_ebooks?: number;
        draft_ebooks?: number;
    };
    filters: {
        search?: string | null;
        status?: string | null;
        digital?: string | null;
        sort?: string;
        direction?: string;
        per_page?: number;
    };
    options: {
        statuses: { value: string; label: string }[];
        digital?: { value: string; label: string }[];
        per_page: { value: number; label: string }[];
    };
    flash?: {
        type: string;
        message: string;
    };
}

export default function LibraryBooksIndex({ user, books, stats, filters, options, flash }: Props) {
    const [search, setSearch] = useState(filters.search ?? "");

    useEffect(() => {
        if (!flash?.message) return;
        if (flash.type === "success") {
            toast.success(flash.message, { id: "library-book-save" });
        } else if (flash.type === "error") {
            toast.error(flash.message);
        } else {
            toast.message(flash.message);
        }
    }, [flash]);

    const handleSearch = useDebouncedCallback((term: string) => {
        router.get(route("administrators.library.books.index"), { ...filters, search: term || null }, { preserveState: true, replace: true });
    }, 300);

    const handleStatusChange = (value: string) => {
        router.get(
            route("administrators.library.books.index"),
            { ...filters, status: value === "all" ? null : value, page: 1 },
            { preserveState: true, replace: true },
        );
    };

    const handleDigitalChange = (value: string) => {
        router.get(
            route("administrators.library.books.index"),
            { ...filters, digital: value === "all" ? null : value, page: 1 },
            { preserveState: true, replace: true },
        );
    };

    const handleSortFieldChange = (value: string) => {
        router.get(route("administrators.library.books.index"), { ...filters, sort: value, page: 1 }, { preserveState: true, replace: true });
    };

    const handleSortDirectionChange = (value: string) => {
        router.get(route("administrators.library.books.index"), { ...filters, direction: value, page: 1 }, { preserveState: true, replace: true });
    };

    const digitalOptions = options.digital ?? [
        { value: "all", label: "All formats" },
        { value: "published", label: "Published eBooks" },
        { value: "downloadable", label: "Downloadable eBooks" },
        { value: "draft", label: "Draft eBooks" },
        { value: "none", label: "Print only" },
    ];

    const sortFieldOptions = [
        { value: "created_at", label: "Recently Added" },
        { value: "publication_year", label: "Publication Year" },
        { value: "title", label: "Title" },
    ];

    const sortDirectionOptions = [
        { value: "desc", label: "Newest / Z → A" },
        { value: "asc", label: "Oldest / A → Z" },
    ];

    const pagination = {
        current_page: books.current_page,
        last_page: books.last_page,
        per_page: books.per_page,
        total: books.total,
        next_page_url: books.next_page_url,
        prev_page_url: books.prev_page_url,
        from: books.from,
        to: books.to,
    };

    return (
        <AdminLayout user={user} title="Library Catalog">
            <Head title="Administrators • Library Books" />

            <div className="flex flex-col gap-6">
                <Card className="via-background border-0 bg-gradient-to-br from-emerald-500/10 to-sky-500/10">
                    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    <BookOpen className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle>Library Books & Hosted eBooks</CardTitle>
                                    <CardDescription>Track print inventory and publish rights-cleared PDF editions for open browser reading.</CardDescription>
                                </div>
                            </div>
                            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                                <span>
                                    Total titles: <strong className="text-foreground tabular-nums">{stats.total_books}</strong>
                                </span>
                                <span>
                                    Copies available: <strong className="text-foreground tabular-nums">{stats.available_copies}</strong>
                                </span>
                                <span>
                                    Borrowed: <strong className="text-foreground tabular-nums">{stats.borrowed_books}</strong>
                                </span>
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                    <FileText className="size-3.5" />
                                    Published eBooks: <strong className="tabular-nums">{stats.published_ebooks ?? 0}</strong>
                                </span>
                                {(stats.draft_ebooks ?? 0) > 0 && (
                                    <span className="text-amber-700 dark:text-amber-400">
                                        Draft eBooks: <strong className="tabular-nums">{stats.draft_ebooks}</strong>
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Link href={publicLibraryIndex.url()} className={buttonVariants({ variant: "outline", className: "gap-2" })}>
                                <ExternalLink className="h-4 w-4" />
                                Public Library
                            </Link>
                            <Link href={createBook.url()} className={buttonVariants({ className: "gap-2" })}>
                                <Plus className="h-4 w-4" />
                                Add Book
                            </Link>
                        </div>
                    </CardHeader>
                </Card>

                <Card>
                    <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <CardTitle>Catalog Overview</CardTitle>
                            <CardDescription>Search by title, author, ISBN, call number, or filter by hosted PDF edition.</CardDescription>
                        </div>
                        <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
                            <div className="relative w-full sm:w-56">
                                <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
                                <Input
                                    placeholder="Search catalog..."
                                    value={search}
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        setSearch(value);
                                        handleSearch(value);
                                    }}
                                    className="pl-9"
                                />
                            </div>
                            <Select value={filters.digital ?? "all"} onValueChange={handleDigitalChange}>
                                <SelectTrigger className="w-full sm:w-44" aria-label="Filter eBook format">
                                    <SelectValue placeholder="eBook format" />
                                </SelectTrigger>
                                <SelectContent>
                                    {digitalOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={filters.status ?? "all"} onValueChange={handleStatusChange}>
                                <SelectTrigger className="w-full sm:w-36" aria-label="Filter circulation status">
                                    <SelectValue placeholder="Filter status" />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.statuses.map((status) => (
                                        <SelectItem key={status.value} value={status.value}>
                                            {status.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={filters.sort ?? "created_at"} onValueChange={handleSortFieldChange}>
                                <SelectTrigger className="w-full sm:w-40" aria-label="Sort field">
                                    <SelectValue placeholder="Sort by" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sortFieldOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={filters.direction ?? "desc"} onValueChange={handleSortDirectionChange}>
                                <SelectTrigger className="w-full sm:w-40" aria-label="Sort direction">
                                    <SelectValue placeholder="Order" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sortDirectionOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <DataTable columns={columns} data={books.data} pagination={pagination} filters={filters} />
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    );
}
