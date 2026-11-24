<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;
use Modules\LibrarySystem\Actions\StoreDigitalEdition;
use Modules\LibrarySystem\Enums\BookFormat;
use Modules\LibrarySystem\Enums\DigitalEditionStatus;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Enums\DigitalRightsBasis;
use Modules\LibrarySystem\Http\Requests\Administrators\BulkDeleteBookRequest;
use Modules\LibrarySystem\Http\Requests\Administrators\BulkForceDeleteBookRequest;
use Modules\LibrarySystem\Http\Requests\Administrators\InspectDigitalEditionRequest;
use Modules\LibrarySystem\Http\Requests\Administrators\LibraryBookIdentifierSuggestionsRequest;
use Modules\LibrarySystem\Http\Requests\Administrators\LibraryBookRequest;
use Modules\LibrarySystem\Models\Author;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\Category;
use Modules\LibrarySystem\Models\DigitalEdition;
use Modules\LibrarySystem\Services\DigitalEditionAiDecisionService;
use Modules\LibrarySystem\Services\DigitalEditionInspectionService;
use Throwable;

final class AdministratorLibraryBookController extends Controller
{
    public function index(Request $request): Response
    {
        $search = $request->input('search');
        $status = $request->input('status');
        $digital = $request->input('digital');
        $sort = $request->string('sort', 'created_at')->toString();
        $direction = $request->string('direction', 'desc')->toString();
        $perPage = $request->integer('per_page', 20);

        $allowedSorts = ['title', 'publication_year', 'created_at'];
        $sort = in_array($sort, $allowedSorts, true) ? $sort : 'created_at';
        $direction = in_array($direction, ['asc', 'desc'], true) ? $direction : 'desc';
        $perPage = in_array($perPage, [10, 20, 50, 100], true) ? $perPage : 20;
        $digital = is_string($digital) && in_array($digital, ['published', 'account_required', 'downloadable', 'draft', 'none', 'ebook_only'], true)
            ? $digital
            : null;

        $booksQuery = Book::query()
            ->with(['author', 'category', 'digitalEdition'])
            ->when(is_string($search) && mb_trim($search) !== '', function ($query) use ($search): void {
                $term = mb_strtolower(mb_trim($search));
                $pattern = "%{$term}%";
                $query->where(function ($nested) use ($pattern): void {
                    $nested->whereRaw('LOWER(title) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(isbn) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(call_number) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(accession_number) LIKE ?', [$pattern])
                        ->orWhereHas('author', fn ($authorQuery) => $authorQuery->whereRaw('LOWER(name) LIKE ?', [$pattern]))
                        ->orWhereHas('category', fn ($categoryQuery) => $categoryQuery->whereRaw('LOWER(name) LIKE ?', [$pattern]));
                });
            })
            ->when(is_string($status) && $status !== '' && $status !== 'all', fn ($query) => $query->where('status', $status))
            ->when($digital === 'published', fn ($query) => $query->whereHas('digitalEdition', fn ($digitalQuery) => $digitalQuery->accessible()))
            ->when($digital === 'account_required', fn ($query) => $query->whereHas('digitalEdition', fn ($digitalQuery) => $digitalQuery->accessible()->whereIn('visibility', [
                DigitalEditionVisibility::Authenticated->value,
                DigitalEditionVisibility::MembersOnly->value,
            ])))
            ->when($digital === 'downloadable', fn ($query) => $query->whereHas('digitalEdition', fn ($digitalQuery) => $digitalQuery->accessible()->where('downloads_allowed', true)))
            ->when($digital === 'draft', fn ($query) => $query->whereHas('digitalEdition', fn ($digitalQuery) => $digitalQuery->where('status', DigitalEditionStatus::Draft->value)))
            ->when($digital === 'ebook_only', fn ($query) => $query->where('format', BookFormat::Ebook->value))
            ->when($digital === 'none', fn ($query) => $query->whereDoesntHave('digitalEdition'));

        $booksQuery->orderBy($sort, $direction)
            ->orderBy('id', $direction);

        /** @var \Illuminate\Contracts\Pagination\LengthAwarePaginator $books */
        $books = $booksQuery->paginate($perPage)
            ->withQueryString()
            ->through(fn (Book $book): array => [
                'id' => $book->id,
                'title' => $book->title,
                'format' => $book->resolvedFormat()->value,
                'isbn' => $book->isbn,
                'call_number' => $book->call_number,
                'accession_number' => $book->accession_number,
                'author' => [
                    'id' => $book->author?->id,
                    'name' => $book->author?->name,
                ],
                'category' => [
                    'id' => $book->category?->id,
                    'name' => $book->category?->name,
                    'color' => $book->category?->color,
                ],
                'status' => $book->status,
                'available_copies' => $book->available_copies,
                'total_copies' => $book->total_copies,
                'publication_year' => $book->publication_year,
                'location' => $book->location,
                'cover_image_url' => $this->resolveCoverImageUrl($book),
                'digital_edition' => $book->digitalEdition ? [
                    'status' => $book->digitalEdition->status->value,
                    'visibility' => $book->digitalEdition->resolvedVisibility()->value,
                    'is_accessible' => $book->digitalEdition->isAccessible(),
                    'downloads_allowed' => $book->digitalEdition->downloads_allowed,
                    'size_bytes' => $book->digitalEdition->size_bytes,
                    'rights_risk_level' => $book->digitalEdition->rights_risk_level,
                    'is_piracy_blocked' => $book->digitalEdition->isPiracyBlocked(),
                ] : null,
                'updated_at' => format_timestamp($book->updated_at),
                'created_at' => format_timestamp($book->created_at),
            ]);

        $stats = [
            'total_books' => Book::count(),
            'available_copies' => (int) Book::sum('available_copies'),
            'borrowed_books' => Book::query()->where('status', 'borrowed')->count(),
            'published_ebooks' => DigitalEdition::query()->accessible()->count(),
            'draft_ebooks' => DigitalEdition::query()->where('status', DigitalEditionStatus::Draft->value)->count(),
        ];

        return Inertia::render('administrators/library/books/index', [
            'user' => $this->getUserProps(),
            'books' => $books,
            'stats' => $stats,
            'filters' => [
                'search' => is_string($search) ? $search : null,
                'status' => is_string($status) ? $status : null,
                'digital' => $digital,
                'sort' => $sort,
                'direction' => $direction,
                'per_page' => $perPage,
            ],
            'options' => [
                'statuses' => [
                    ['value' => 'all', 'label' => 'All statuses'],
                    ['value' => 'available', 'label' => 'Available'],
                    ['value' => 'borrowed', 'label' => 'Borrowed'],
                    ['value' => 'maintenance', 'label' => 'Maintenance'],
                ],
                'digital' => [
                    ['value' => 'all', 'label' => 'All formats'],
                    ['value' => 'published', 'label' => 'Published eBooks'],
                    ['value' => 'account_required', 'label' => 'Account-required eBooks'],
                    ['value' => 'downloadable', 'label' => 'Downloadable eBooks'],
                    ['value' => 'draft', 'label' => 'Draft eBooks'],
                    ['value' => 'ebook_only', 'label' => 'eBook-only titles'],
                    ['value' => 'none', 'label' => 'Print only'],
                ],
                'per_page' => [
                    ['value' => 10, 'label' => '10'],
                    ['value' => 20, 'label' => '20'],
                    ['value' => 50, 'label' => '50'],
                    ['value' => 100, 'label' => '100'],
                ],
            ],
            'flash' => session('flash'),
        ]);
    }

    public function create(Request $request, DigitalEditionAiDecisionService $aiDecision): Response
    {
        $requestedFormat = BookFormat::tryFrom((string) $request->query('format', BookFormat::Physical->value))
            ?? BookFormat::Physical;

        return Inertia::render('administrators/library/books/edit', [
            'user' => $this->getUserProps(),
            'book' => null,
            'initial_format' => $requestedFormat->value,
            'can_manage_digital_edition' => $request->user()?->can('manageDigitalEdition', new Book) ?? false,
            'ai_catalog_assist' => $aiDecision->availability(),
            'options' => $this->getBookOptions(),
            'flash' => session('flash'),
        ]);
    }

    public function inspectPdf(
        InspectDigitalEditionRequest $request,
        DigitalEditionInspectionService $inspector
    ): JsonResponse {
        $file = $request->file('pdf');
        abort_unless($file instanceof UploadedFile, 422, 'Choose a PDF file to inspect.');

        $useAi = $request->has('use_ai') ? $request->boolean('use_ai') : true;

        $result = $inspector->inspectFile(
            $file->getRealPath(),
            $file->getClientOriginalName(),
            useAi: $useAi
        );

        return response()->json($result);
    }

    public function fieldValues(LibraryBookIdentifierSuggestionsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $field = match ($validated['field']) {
            'isbn' => 'isbn',
            'call_number' => 'call_number',
        };
        $search = mb_trim((string) ($validated['search'] ?? ''));

        $values = Book::query()
            ->select($field)
            ->whereNotNull($field)
            ->where($field, '!=', '')
            ->when($search !== '', fn ($query) => $query->whereLike($field, "%{$search}%"))
            ->distinct()
            ->orderBy($field)
            ->limit(25)
            ->pluck($field)
            ->values();

        return response()->json([
            'values' => $values,
        ]);
    }

    public function store(LibraryBookRequest $request, StoreDigitalEdition $storeDigitalEdition): RedirectResponse
    {
        $rawValidated = $request->validated();
        $validated = $this->normalizeBookData($rawValidated);

        $coverImage = $request->file('cover_image_upload');
        if ($coverImage instanceof UploadedFile) {
            $validated['cover_image_path'] = $this->storeCoverImage($coverImage);
        }

        $digitalPdf = $request->file('digital_pdf');
        $digitalAttributes = [
            'visibility' => $rawValidated['digital_visibility'] ?? null,
            'rights_basis' => $rawValidated['digital_rights_basis'] ?? null,
            'rights_holder' => $rawValidated['digital_rights_holder'] ?? null,
            'license_url' => $rawValidated['digital_license_url'] ?? null,
            'rights_notes' => $rawValidated['digital_rights_notes'] ?? null,
            'rights_expires_at' => $rawValidated['digital_rights_expires_at'] ?? null,
        ];

        unset(
            $validated['cover_image_upload'],
            $validated['digital_pdf'],
            $validated['digital_visibility'],
            $validated['digital_rights_basis'],
            $validated['digital_rights_holder'],
            $validated['digital_license_url'],
            $validated['digital_rights_notes'],
            $validated['digital_rights_expires_at'],
        );

        $book = Book::create($validated);
        $actor = $request->user();

        if ($digitalPdf instanceof UploadedFile
            && $actor instanceof User
            && $actor->can('manageDigitalEdition', $book)) {
            $edition = $storeDigitalEdition->execute($book, $digitalPdf, $digitalAttributes, $actor);

            $flashMessage = $edition->isPiracyBlocked()
                ? 'Book saved, but publishing is blocked because the uploaded PDF matched a known piracy source. Replace or remove the file below.'
                : 'Book and eBook PDF saved as a draft. Review the copyright screening and rights settings below before publishing.';

            return redirect()
                ->to(route('administrators.library.books.edit', $book).'#digital-edition')
                ->with('flash', [
                    'type' => $edition->isPiracyBlocked() ? 'error' : 'success',
                    'message' => $flashMessage,
                ]);
        }

        return redirect()
            ->route('administrators.library.books.index')
            ->with('flash', [
                'type' => 'success',
                'message' => 'Book added to the catalog.',
            ]);
    }

    public function edit(Book $book, DigitalEditionAiDecisionService $aiDecision): Response
    {
        $book->load('digitalEdition');
        $edition = $book->digitalEdition;

        return Inertia::render('administrators/library/books/edit', [
            'user' => $this->getUserProps(),
            'book' => [
                'id' => $book->id,
                'format' => $book->resolvedFormat()->value,
                'title' => $book->title,
                'isbn' => $book->isbn,
                'call_number' => $book->call_number,
                'accession_number' => $book->accession_number,
                'author_id' => $book->author_id,
                'category_id' => $book->category_id,
                'publisher' => $book->publisher,
                'publication_year' => $book->publication_year,
                'pages' => $book->pages,
                'description' => $book->description,
                'cover_image' => $book->cover_image,
                'cover_image_path' => $book->cover_image_path,
                'cover_image_url' => $this->resolveCoverImageUrl($book),
                'total_copies' => $book->total_copies,
                'available_copies' => $book->available_copies,
                'location' => $book->location,
                'status' => $book->status,
                'digital_edition' => $edition ? [
                    'id' => $edition->id,
                    'original_name' => $edition->original_name,
                    'mime_type' => $edition->mime_type,
                    'size_bytes' => $edition->size_bytes,
                    'status' => $edition->status->value,
                    'visibility' => $edition->resolvedVisibility()->value,
                    'downloads_allowed' => $edition->downloads_allowed,
                    'rights_basis' => $edition->rights_basis?->value,
                    'rights_holder' => $edition->rights_holder,
                    'license_url' => $edition->license_url,
                    'rights_notes' => $edition->rights_notes,
                    'rights_scan' => $edition->rights_scan,
                    'rights_risk_level' => $edition->rights_risk_level,
                    'is_piracy_blocked' => $edition->isPiracyBlocked(),
                    'rights_expires_at' => $edition->rights_expires_at?->format('Y-m-d'),
                    'uploaded_at' => $edition->uploaded_at?->toIso8601String(),
                    'published_at' => $edition->published_at?->toIso8601String(),
                ] : null,
                'can_manage_digital_edition' => request()->user()?->can('manageDigitalEdition', $book) ?? false,
            ],
            'initial_format' => $book->resolvedFormat()->value,
            'can_manage_digital_edition' => request()->user()?->can('manageDigitalEdition', $book) ?? false,
            'ai_catalog_assist' => $aiDecision->availability(),
            'options' => $this->getBookOptions(),
            'flash' => session('flash'),
        ]);
    }

    public function update(LibraryBookRequest $request, Book $book): RedirectResponse
    {
        $rawValidated = $request->validated();
        $validated = $this->normalizeBookData($rawValidated);

        $coverImage = $request->file('cover_image_upload');
        if ($coverImage instanceof UploadedFile) {
            $validated['cover_image_path'] = $this->storeCoverImage($coverImage, $book->cover_image_path);
        }

        unset(
            $validated['cover_image_upload'],
            $validated['digital_pdf'],
            $validated['digital_visibility'],
            $validated['digital_rights_basis'],
            $validated['digital_rights_holder'],
            $validated['digital_license_url'],
            $validated['digital_rights_notes'],
            $validated['digital_rights_expires_at'],
        );

        $book->update($validated);

        return redirect()
            ->route('administrators.library.books.index')
            ->with('flash', [
                'type' => 'success',
                'message' => 'Book details updated.',
            ]);
    }

    public function destroy(Book $book): RedirectResponse
    {
        $this->deleteCoverImage($book);

        $book->delete();

        return redirect()
            ->route('administrators.library.books.index')
            ->with('flash', [
                'type' => 'success',
                'message' => 'Book removed from the catalog.',
            ]);
    }

    public function bulkDestroy(BulkDeleteBookRequest $request): RedirectResponse
    {
        $validated = $request->validated();
        $ids = $validated['book_ids'];

        $books = Book::query()->whereIn('id', $ids)->get();

        foreach ($books as $book) {
            Gate::authorize('delete', $book);
            $this->deleteCoverImage($book);
            $book->delete();
        }

        return redirect()
            ->route('administrators.library.books.index')
            ->with('flash', [
                'type' => 'success',
                'message' => "{$books->count()} book(s) moved to trash.",
            ]);
    }

    public function bulkForceDestroy(BulkForceDeleteBookRequest $request): RedirectResponse
    {
        $validated = $request->validated();
        $ids = $validated['book_ids'];
        $confirmText = (string) ($validated['confirm_text'] ?? '');
        $count = count($ids);
        $expected = $count === 1
            ? 'PERMANENTLY DELETE 1 BOOK'
            : "PERMANENTLY DELETE {$count} BOOKS";

        if (! hash_equals($expected, $confirmText)) {
            return back()->withErrors([
                'confirm_text' => 'The confirmation text does not match.',
            ]);
        }

        Gate::authorize('forceDeleteAny', Book::class);

        $books = Book::withTrashed()->whereIn('id', $ids)->get();
        $failures = [];
        $deletedCount = 0;

        foreach ($books as $book) {
            Gate::authorize('forceDelete', $book);

            try {
                DB::transaction(function () use ($book): void {
                    $this->deleteCoverImage($book);

                    $edition = $book->digitalEdition;
                    if ($edition !== null) {
                        try {
                            Storage::disk($edition->disk)->delete($edition->path);
                        } catch (Throwable $throwable) {
                            report($throwable);
                        }
                    }

                    $book->forceDelete();
                });

                $deletedCount++;
            } catch (Throwable $throwable) {
                report($throwable);
                $failures[] = $book->title;
            }
        }

        if ($failures !== []) {
            return redirect()
                ->route('administrators.library.books.index')
                ->with('flash', [
                    'type' => 'error',
                    'message' => "Deleted {$deletedCount} book(s). Failed to delete: ".implode(', ', $failures).'.',
                ]);
        }

        return redirect()
            ->route('administrators.library.books.index')
            ->with('flash', [
                'type' => 'success',
                'message' => "{$deletedCount} book(s) permanently deleted.",
            ]);
    }

    private function deleteCoverImage(Book $book): void
    {
        if (is_string($book->cover_image_path) && $book->cover_image_path !== '') {
            Storage::disk('public')->delete($book->cover_image_path);
        }
    }

    private function normalizeBookData(array $validated): array
    {
        $format = BookFormat::tryFrom((string) ($validated['format'] ?? BookFormat::Physical->value))
            ?? BookFormat::Physical;

        $validated['format'] = $format->value;

        if (! $format->hasPhysicalInventory()) {
            $validated['total_copies'] = 0;
            $validated['available_copies'] = 0;
            $validated['status'] = 'available';
            $validated['location'] = null;
            $validated['call_number'] = $validated['call_number'] ?? null;
            $validated['accession_number'] = $validated['accession_number'] ?? null;

            return $validated;
        }

        $totalCopies = max(1, (int) ($validated['total_copies'] ?? 1));
        $availableCopies = isset($validated['available_copies']) && $validated['available_copies'] !== null
            ? (int) $validated['available_copies']
            : $totalCopies;

        $validated['total_copies'] = $totalCopies;
        $validated['available_copies'] = min(max(0, $availableCopies), $totalCopies);
        $validated['status'] = $validated['status'] ?? 'available';

        return $validated;
    }

    private function storeCoverImage(UploadedFile $file, ?string $currentPath = null): string
    {
        if ($currentPath) {
            Storage::disk('public')->delete($currentPath);
        }

        return $file->storePublicly('library/books/covers', 'public');
    }

    private function resolveCoverImageUrl(Book $book): ?string
    {
        if (is_string($book->cover_image_path) && $book->cover_image_path !== '') {
            return Storage::disk('public')->url($book->cover_image_path);
        }

        if (is_string($book->cover_image) && $book->cover_image !== '') {
            return $book->cover_image;
        }

        return null;
    }

    private function getBookOptions(): array
    {
        return [
            'formats' => collect(BookFormat::cases())
                ->map(fn (BookFormat $format): array => [
                    'value' => $format->value,
                    'label' => $format->label(),
                ])
                ->all(),
            'authors' => Author::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->get()
                ->map(fn (Author $author): array => [
                    'value' => $author->id,
                    'label' => $author->name,
                ])
                ->values()
                ->all(),
            'categories' => Category::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->get()
                ->map(fn (Category $category): array => [
                    'value' => $category->id,
                    'label' => $category->name,
                ])
                ->values()
                ->all(),
            'statuses' => [
                ['value' => 'available', 'label' => 'Available'],
                ['value' => 'borrowed', 'label' => 'Borrowed'],
                ['value' => 'maintenance', 'label' => 'Maintenance'],
            ],
            'digital_rights_bases' => collect(DigitalRightsBasis::cases())
                ->map(fn (DigitalRightsBasis $basis): array => [
                    'value' => $basis->value,
                    'label' => $basis->label(),
                ])
                ->all(),
            'digital_visibilities' => collect(DigitalEditionVisibility::cases())
                ->map(fn (DigitalEditionVisibility $visibility): array => [
                    'value' => $visibility->value,
                    'label' => $visibility->label(),
                    'short_label' => $visibility->shortLabel(),
                    'description' => $visibility->description(),
                ])
                ->all(),
        ];
    }

    private function getUserProps(): array
    {
        $user = request()->user();

        if (! $user) {
            return [];
        }

        return [
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar_url ?? null,
            'role' => $user->role?->getLabel() ?? 'Administrator',
        ];
    }
}
