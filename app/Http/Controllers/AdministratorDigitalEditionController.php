<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Modules\LibrarySystem\Actions\StoreDigitalEdition;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Http\Requests\Administrators\StoreDigitalEditionRequest;
use Modules\LibrarySystem\Http\Requests\Administrators\UpdateDigitalEditionRequest;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\DigitalEdition;
use Throwable;

final class AdministratorDigitalEditionController extends Controller
{
    public function store(
        StoreDigitalEditionRequest $request,
        Book $book,
        StoreDigitalEdition $storeDigitalEdition
    ): RedirectResponse {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $edition = $storeDigitalEdition->execute(
            $book,
            $request->file('pdf'),
            $request->safe()->except(['pdf']),
            $user
        );

        return back()->with('flash', [
            'type' => $edition->isPiracyBlocked() ? 'error' : 'success',
            'message' => $edition->isPiracyBlocked()
                ? 'Digital edition saved as draft, but publishing is blocked because a known piracy source watermark was detected.'
                : 'Digital edition uploaded as a draft. Review the copyright screening and publish it separately.',
        ]);
    }

    public function update(
        UpdateDigitalEditionRequest $request,
        Book $book,
        StoreDigitalEdition $storeDigitalEdition
    ): RedirectResponse {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $edition = DB::transaction(function () use ($book, $request, $storeDigitalEdition, $user): DigitalEdition {
            $edition = DigitalEdition::query()
                ->where('book_id', $book->id)
                ->lockForUpdate()
                ->firstOrFail();

            $edition->fill($storeDigitalEdition->editionAttributes(
                $request->validated(),
                $user,
                $edition->resolvedVisibility()
            ));
            $edition->save();

            activity('library')
                ->causedBy($user)
                ->performedOn($book)
                ->withProperties([
                    'digital_edition_id' => $edition->id,
                    'status' => $edition->status->value,
                    'visibility' => $edition->resolvedVisibility()->value,
                    'downloads_allowed' => $edition->downloads_allowed,
                ])
                ->log('Updated digital edition publication settings');

            return $edition;
        });

        $message = 'Digital edition saved as a draft.';
        if ($edition->isAccessible()) {
            $message = match ($edition->resolvedVisibility()) {
                DigitalEditionVisibility::MembersOnly => 'Digital edition published for signed-in users only (hidden from guests).',
                DigitalEditionVisibility::Authenticated => 'Digital edition published (account required to read).',
                DigitalEditionVisibility::Public => 'Digital edition published publicly.',
            };
        }

        return back()->with('flash', [
            'type' => 'success',
            'message' => $message,
        ]);
    }

    public function destroy(Book $book): RedirectResponse
    {
        Gate::authorize('manageDigitalEdition', $book);

        $edition = DB::transaction(function () use ($book): DigitalEdition {
            $edition = DigitalEdition::query()
                ->where('book_id', $book->id)
                ->lockForUpdate()
                ->firstOrFail();

            activity('library')
                ->causedBy(request()->user())
                ->performedOn($book)
                ->withProperties([
                    'digital_edition_id' => $edition->id,
                ])
                ->log('Removed a digital edition');

            $edition->delete();

            if ($book->resolvedFormat() === \Modules\LibrarySystem\Enums\BookFormat::Hybrid) {
                $book->forceFill(['format' => \Modules\LibrarySystem\Enums\BookFormat::Physical])->save();
            }

            return $edition;
        });

        try {
            Storage::disk($edition->disk)->delete($edition->path);
        } catch (Throwable $throwable) {
            report($throwable);
        }

        return back()->with('flash', [
            'type' => 'success',
            'message' => 'Digital edition removed.',
        ]);
    }
}
