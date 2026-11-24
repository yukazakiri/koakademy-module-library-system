<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Inertia\Response;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Http\Requests\DigitalLibraryCatalogRequest;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\DigitalEdition;
use Modules\LibrarySystem\Models\UserBookState;
use Modules\LibrarySystem\Services\DigitalCatalogService;
use Modules\LibrarySystem\Services\DigitalEditionDeliveryService;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

final class DigitalLibraryController extends Controller
{
    public function __construct(
        private readonly DigitalCatalogService $catalog,
        private readonly DigitalEditionDeliveryService $delivery,
    ) {}

    public function index(DigitalLibraryCatalogRequest $request): Response
    {
        $validated = $request->validated();
        $user = $request->user();
        $authenticatedUser = $user instanceof User ? $user : null;

        $search = mb_trim((string) ($validated['search'] ?? ''));
        $availability = (string) ($validated['availability'] ?? 'all');
        $collection = $authenticatedUser instanceof User ? (string) ($validated['collection'] ?? 'all') : 'all';
        $sort = (string) ($validated['sort'] ?? 'title');

        return Inertia::render('library/index', [
            'books' => $this->catalog->paginateCatalog($authenticatedUser, [
                ...$validated,
                'search' => $search,
                'availability' => $availability,
                'collection' => $collection,
                'sort' => $sort,
            ]),
            'filters' => [
                'search' => $search,
                'category_id' => $validated['category_id'] ?? null,
                'year' => $validated['year'] ?? null,
                'availability' => $availability,
                'collection' => $collection,
                'sort' => $sort,
            ],
            'options' => $this->catalog->catalogOptions(),
            'stats' => $this->catalog->catalogStats($authenticatedUser),
            'access' => $this->authUrls($authenticatedUser),
        ]);
    }

    public function show(Request $request, Book $book): Response|RedirectResponse
    {
        $user = $request->user();
        $authenticatedUser = $user instanceof User ? $user : null;

        if (! $authenticatedUser instanceof User
            && $book->isEbookOnly()
            && $book->digitalEdition()
                ->accessible()
                ->where('visibility', DigitalEditionVisibility::MembersOnly->value)
                ->exists()) {
            if ($request->expectsJson()) {
                abort(401, 'Sign in to view this eBook.');
            }

            return redirect()->guest(Route::has('login') ? route('login') : '/login');
        }

        $book->load([
            'author:id,name,biography',
            'category:id,name,color,description',
            'digitalEdition' => fn ($query) => $query
                ->catalogVisibleFor($authenticatedUser)
                ->select([
                    'id',
                    'book_id',
                    'visibility',
                    'downloads_allowed',
                    'size_bytes',
                    'rights_basis',
                    'rights_holder',
                    'license_url',
                    'rights_expires_at',
                ]),
        ]);

        $state = $authenticatedUser instanceof User
            ? UserBookState::query()
                ->where('user_id', $authenticatedUser->id)
                ->where('book_id', $book->id)
                ->first()
            : null;

        $edition = $book->digitalEdition;
        $downloadsAllowed = $edition instanceof DigitalEdition && $edition->downloads_allowed;
        $readRequiresAuth = $edition instanceof DigitalEdition
            && ! $authenticatedUser instanceof User
            && $edition->requiresAccountToRead();
        $readyAction = $authenticatedUser instanceof User && $request->string('action')->toString() === 'download'
            ? 'download'
            : null;

        return Inertia::render('library/show', [
            'book' => $this->catalog->bookDetailData($book),
            'state' => [
                'is_favorite' => $state?->favorited_at !== null,
                'last_page' => $state?->last_page,
                'total_pages' => $state?->total_pages,
                'last_read_at' => $state?->last_read_at?->toIso8601String(),
            ],
            'related' => $this->catalog->relatedBooks($book, $authenticatedUser),
            'takedown_email' => config('librarysystem.ebooks.takedown_email'),
            'access' => [
                ...$this->authUrls($authenticatedUser),
                'can_read' => $edition instanceof DigitalEdition && ! $readRequiresAuth,
                'read_requires_auth' => $readRequiresAuth,
                'read_authenticate_url' => route('library.books.authenticate', [
                    'book' => $book,
                    'from' => 'read',
                    'action' => 'read',
                ]),
                'can_download' => $authenticatedUser instanceof User && $downloadsAllowed,
                'download_requires_auth' => ! $authenticatedUser instanceof User && $downloadsAllowed,
                'authenticate_url' => route('library.books.authenticate', $book),
                'ready_action' => $readyAction,
            ],
        ]);
    }

    public function read(Request $request, Book $book): Response|RedirectResponse
    {
        $user = $request->user();
        $authenticatedUser = $user instanceof User ? $user : null;

        $book->load(['author:id,name', 'digitalEdition' => fn ($query) => $query->accessible()]);
        $edition = $book->digitalEdition;

        abort_unless($edition instanceof DigitalEdition, 404);

        if (! $authenticatedUser instanceof User && $edition->requiresAccountToRead()) {
            if ($request->expectsJson()) {
                abort(401, 'Sign in to read this eBook.');
            }

            return redirect()->guest(Route::has('login') ? route('login') : '/login');
        }

        $this->delivery->assertObjectExists($edition);

        $state = null;
        $bookmarks = collect();

        if ($authenticatedUser instanceof User) {
            $state = UserBookState::query()->firstOrCreate([
                'user_id' => $authenticatedUser->id,
                'book_id' => $book->id,
            ]);
            $state->forceFill(['last_read_at' => now()])->save();

            $bookmarks = $book->bookmarks()
                ->where('user_id', $authenticatedUser->id)
                ->orderBy('page')
                ->get(['id', 'page', 'label']);
        }

        $canDownload = $authenticatedUser instanceof User && $edition->downloads_allowed;
        $readyAction = $authenticatedUser instanceof User && $request->string('action')->toString() === 'download'
            ? 'download'
            : null;

        return Inertia::render('library/read', [
            'book' => [
                'id' => $book->id,
                'title' => $book->title,
                'author' => $book->author?->name,
                'visibility' => $edition->resolvedVisibility()->value,
                'downloads_allowed' => $edition->downloads_allowed,
                'file_size_bytes' => $edition->size_bytes,
            ],
            'reader' => [
                'content_url' => route('library.books.content', $book),
                'download_url' => $canDownload ? route('library.books.download', $book) : null,
                'last_page' => $state?->last_page ?? 1,
                'total_pages' => $state?->total_pages ?? $book->pages,
                'bookmarks' => $bookmarks,
                'sync_enabled' => $authenticatedUser instanceof User,
                'is_guest' => ! $authenticatedUser instanceof User,
                'can_download' => $canDownload,
                'download_requires_auth' => ! $authenticatedUser instanceof User && $edition->downloads_allowed,
                'authenticate_url' => route('library.books.authenticate', ['book' => $book, 'from' => 'read']),
                'ready_action' => $readyAction,
                ...$this->authUrls($authenticatedUser),
            ],
        ]);
    }

    public function content(Request $request, Book $book): HttpResponse
    {
        $edition = $this->delivery->accessibleEdition($book);

        if ($edition->requiresAccountToRead()) {
            abort_unless($request->user() instanceof User, 401, 'Sign in to view this eBook.');
        }

        $this->delivery->assertObjectExists($edition);

        return $this->delivery->inlineResponse($book, $edition);
    }

    public function download(Request $request, Book $book): HttpResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $edition = $this->delivery->accessibleEdition($book);

        return $this->delivery->downloadResponse($book, $edition, $user);
    }

    public function authenticate(Request $request, Book $book): RedirectResponse
    {
        $from = $request->string('from')->toString();
        $action = $request->string('action', 'download')->toString();

        if ($from === 'read' && $book->digitalEdition()->accessible()->exists()) {
            if ($action === 'read') {
                return redirect()->route('library.books.read', $book);
            }

            return redirect()->route('library.books.read', [
                'book' => $book,
                'action' => 'download',
            ]);
        }

        return redirect()->route('library.books.show', [
            'book' => $book,
            'action' => 'download',
        ]);
    }

    /**
     * @return array{is_authenticated: bool, login_url: string, signup_url: string}
     */
    private function authUrls(?User $user): array
    {
        return [
            'is_authenticated' => $user instanceof User,
            'login_url' => Route::has('login') ? route('login') : '/login',
            'signup_url' => Route::has('signup') ? route('signup') : '/signup',
        ];
    }
}
