<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Services;

use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\LibrarySystem\Enums\BookFormat;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\Category;
use Modules\LibrarySystem\Models\DigitalEdition;
use Modules\LibrarySystem\Models\UserBookState;

final class DigitalCatalogService
{
    /**
     * @param  array<string, mixed>  $filters
     */
    public function paginateCatalog(?User $user, array $filters): LengthAwarePaginator
    {
        $search = mb_trim((string) ($filters['search'] ?? ''));
        $availability = (string) ($filters['availability'] ?? 'all');
        $collection = $user instanceof User ? (string) ($filters['collection'] ?? 'all') : 'all';
        $sort = (string) ($filters['sort'] ?? 'title');

        $query = Book::query()
            ->select([
                'id',
                'format',
                'title',
                'isbn',
                'call_number',
                'author_id',
                'category_id',
                'publisher',
                'publication_year',
                'pages',
                'description',
                'cover_image',
                'cover_image_path',
                'created_at',
            ])
            ->with([
                'author:id,name',
                'category:id,name,color',
                'digitalEdition' => fn ($query) => $query
                    ->catalogVisibleFor($user)
                    ->select(['id', 'book_id', 'visibility', 'downloads_allowed', 'size_bytes', 'rights_expires_at']),
            ]);

        $this->applyGuestBookVisibility($query, $user);

        $query
            ->when($user instanceof User, function (Builder $query) use ($user): void {
                $query->withExists([
                    'userStates as is_favorite' => fn (Builder $stateQuery) => $stateQuery
                        ->where('user_id', $user->id)
                        ->whereNotNull('favorited_at'),
                ]);
            })
            ->when($search !== '', function (Builder $query) use ($search): void {
                $query->where(function (Builder $query) use ($search): void {
                    $query
                        ->whereLike('title', "%{$search}%")
                        ->orWhereLike('isbn', "%{$search}%")
                        ->orWhereLike('call_number', "%{$search}%")
                        ->orWhereHas('author', fn (Builder $query) => $query->whereLike('name', "%{$search}%"))
                        ->orWhereHas('category', fn (Builder $query) => $query->whereLike('name', "%{$search}%"));
                });
            })
            ->when(
                isset($filters['category_id']),
                fn (Builder $query) => $query->where('category_id', $filters['category_id'])
            )
            ->when(
                isset($filters['year']),
                fn (Builder $query) => $query->where('publication_year', $filters['year'])
            )
            ->when(
                $availability === 'online',
                fn (Builder $query) => $query->whereHas('digitalEdition', fn (Builder $query) => $query->catalogVisibleFor($user))
            )
            ->when(
                $availability === 'catalog',
                fn (Builder $query) => $query->whereDoesntHave('digitalEdition', fn (Builder $query) => $query->catalogVisibleFor($user))
            )
            ->when(
                $user instanceof User && $collection === 'favorites',
                fn (Builder $query) => $query->whereHas('userStates', fn (Builder $query) => $query
                    ->where('user_id', $user->id)
                    ->whereNotNull('favorited_at'))
            )
            ->when(
                $user instanceof User && $collection === 'recent',
                fn (Builder $query) => $query->whereHas('userStates', fn (Builder $query) => $query
                    ->where('user_id', $user->id)
                    ->whereNotNull('last_read_at'))
            );

        $this->applySort($query, $sort, $collection, $user);

        return $query
            ->paginate(24)
            ->withQueryString()
            ->through(fn (Book $book): array => $this->bookCardData($book));
    }

    /**
     * @return array{categories: Collection<int, Category>, years: Collection<int, int>}
     */
    public function catalogOptions(): array
    {
        return [
            'categories' => Category::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->get(),
            'years' => Book::query()
                ->whereNotNull('publication_year')
                ->distinct()
                ->orderByDesc('publication_year')
                ->pluck('publication_year'),
        ];
    }

    /**
     * @return array{catalog_books: int, available_online: int, favorites: int}
     */
    public function catalogStats(?User $user): array
    {
        $catalogBooksQuery = Book::query();
        $this->applyGuestBookVisibility($catalogBooksQuery, $user);

        return [
            'catalog_books' => $catalogBooksQuery->count(),
            'available_online' => DigitalEdition::query()->catalogVisibleFor($user)->whereHas('book')->count(),
            'favorites' => $user instanceof User
                ? UserBookState::query()
                    ->where('user_id', $user->id)
                    ->whereNotNull('favorited_at')
                    ->whereHas('book')
                    ->count()
                : 0,
        ];
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    public function relatedBooks(Book $book, ?User $user = null, int $limit = 4): Collection
    {
        $query = Book::query()
            ->select(['id', 'format', 'title', 'author_id', 'category_id', 'publication_year', 'pages', 'description', 'cover_image', 'cover_image_path'])
            ->where('category_id', $book->category_id)
            ->whereKeyNot($book->id)
            ->with([
                'author:id,name',
                'category:id,name,color',
                'digitalEdition' => fn ($query) => $query
                    ->catalogVisibleFor($user)
                    ->select(['id', 'book_id', 'visibility', 'downloads_allowed', 'size_bytes']),
            ]);

        $this->applyGuestBookVisibility($query, $user);

        return $query
            ->orderBy('title')
            ->orderBy('id')
            ->limit($limit)
            ->get()
            ->map(fn (Book $relatedBook): array => $this->bookCardData($relatedBook));
    }

    /**
     * @return array<string, mixed>
     */
    public function bookCardData(Book $book): array
    {
        $edition = $book->digitalEdition;

        return [
            'id' => $book->id,
            'title' => $book->title,
            'author' => $book->author?->name,
            'category' => $book->category?->name,
            'category_color' => $book->category?->color,
            'publication_year' => $book->publication_year,
            'description' => Str::limit(strip_tags((string) $book->description), 150),
            'cover_image_url' => $this->coverImageUrl($book),
            'available_online' => $edition instanceof DigitalEdition,
            'visibility' => $edition?->resolvedVisibility()->value,
            'requires_account_to_read' => $edition instanceof DigitalEdition && $edition->requiresAccountToRead(),
            'downloads_allowed' => $edition?->downloads_allowed ?? false,
            'file_size_bytes' => $edition?->size_bytes,
            'is_favorite' => (bool) ($book->is_favorite ?? false),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function bookDetailData(Book $book): array
    {
        $edition = $book->digitalEdition;

        return [
            'id' => $book->id,
            'title' => $book->title,
            'isbn' => $book->isbn,
            'call_number' => $book->call_number,
            'accession_number' => $book->accession_number,
            'author' => $book->author?->name,
            'author_biography' => $book->author?->biography,
            'category' => $book->category?->name,
            'category_color' => $book->category?->color,
            'publisher' => $book->publisher,
            'publication_year' => $book->publication_year,
            'pages' => $book->pages,
            'description' => $book->description,
            'location' => $book->location,
            'cover_image_url' => $this->coverImageUrl($book),
            'available_online' => $edition instanceof DigitalEdition,
            'visibility' => $edition?->resolvedVisibility()->value,
            'requires_account_to_read' => $edition instanceof DigitalEdition && $edition->requiresAccountToRead(),
            'downloads_allowed' => $edition?->downloads_allowed ?? false,
            'file_size_bytes' => $edition?->size_bytes,
            'rights_basis' => $edition?->rights_basis?->value,
            'rights_holder' => $edition?->rights_holder,
            'license_url' => $edition?->license_url,
            'rights_expires_at' => $edition?->rights_expires_at?->toIso8601String(),
        ];
    }

    private function applyGuestBookVisibility(Builder $query, ?User $user): void
    {
        if ($user instanceof User) {
            return;
        }

        $query->where(function (Builder $visible): void {
            $visible
                ->where('format', '!=', BookFormat::Ebook->value)
                ->orWhereDoesntHave('digitalEdition', fn (Builder $editionQuery) => $editionQuery
                    ->accessible()
                    ->where('visibility', DigitalEditionVisibility::MembersOnly->value));
        });
    }

    private function applySort(Builder $query, string $sort, string $collection, ?User $user): void
    {
        if ($user instanceof User && $collection === 'recent') {
            $query->orderByDesc(
                UserBookState::query()
                    ->select('last_read_at')
                    ->whereColumn('book_id', 'library_books.id')
                    ->where('user_id', $user->id)
                    ->limit(1)
            )->orderBy('id');

            return;
        }

        match ($sort) {
            'year_newest' => $query->orderByDesc('publication_year')->orderBy('title')->orderBy('id'),
            'year_oldest' => $query->orderBy('publication_year')->orderBy('title')->orderBy('id'),
            'recently_added' => $query->orderByDesc('created_at')->orderByDesc('id'),
            default => $query->orderBy('title')->orderBy('id'),
        };
    }

    private function coverImageUrl(Book $book): ?string
    {
        if (filled($book->cover_image_path)) {
            return Storage::disk('public')->url((string) $book->cover_image_path);
        }

        if (! filled($book->cover_image)) {
            return null;
        }

        $url = filter_var($book->cover_image, FILTER_VALIDATE_URL);
        $scheme = is_string($url) ? parse_url($url, PHP_URL_SCHEME) : null;

        return is_string($url) && in_array($scheme, ['http', 'https'], true) ? $url : null;
    }
}
