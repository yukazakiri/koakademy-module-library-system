<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Actions;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\LibrarySystem\Enums\BookFormat;
use Modules\LibrarySystem\Enums\DigitalEditionStatus;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\DigitalEdition;
use Modules\LibrarySystem\Services\DigitalEditionInspectionService;
use RuntimeException;
use Throwable;

final class StoreDigitalEdition
{
    public function __construct(
        private readonly DigitalEditionInspectionService $inspector = new DigitalEditionInspectionService,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function execute(Book $book, UploadedFile $file, array $attributes, User $actor): DigitalEdition
    {
        $attributes['status'] = DigitalEditionStatus::Draft->value;
        $attributes['downloads_allowed'] = false;

        $inspection = $this->inspector->inspectFile(
            $file->getRealPath(),
            $file->getClientOriginalName(),
            useAi: false
        );
        $rightsScan = $inspection['rights_scan'];
        $riskLevel = (string) ($rightsScan['risk_level'] ?? 'neutral');

        $disk = (string) config('librarysystem.ebooks.disk', 'library');
        $path = sprintf(
            'books/%d/%s.pdf',
            $book->id,
            Str::uuid()->toString()
        );
        $sha256 = hash_file('sha256', $file->getRealPath());
        $stream = fopen($file->getRealPath(), 'rb');

        if ($stream === false) {
            throw new RuntimeException('The uploaded PDF could not be opened.');
        }

        try {
            Storage::disk($disk)->writeStream($path, $stream, [
                'visibility' => 'private',
                'ContentType' => 'application/pdf',
            ]);
        } finally {
            fclose($stream);
        }

        try {
            [$edition, $previousObject] = DB::transaction(function () use (
                $book,
                $file,
                $attributes,
                $actor,
                $disk,
                $path,
                $sha256,
                $rightsScan,
                $riskLevel
            ): array {
                $lockedBook = Book::query()->whereKey($book->id)->lockForUpdate()->firstOrFail();

                if ($lockedBook->resolvedFormat() === BookFormat::Physical) {
                    $lockedBook->forceFill([
                        'format' => $lockedBook->total_copies > 0 ? BookFormat::Hybrid : BookFormat::Ebook,
                    ])->save();
                }

                $edition = DigitalEdition::query()
                    ->where('book_id', $book->id)
                    ->lockForUpdate()
                    ->first();

                $previousObject = $edition instanceof DigitalEdition
                    ? ['disk' => $edition->disk, 'path' => $edition->path]
                    : null;

                $existingVisibility = $edition instanceof DigitalEdition
                    ? $edition->resolvedVisibility()
                    : null;

                $edition ??= new DigitalEdition(['book_id' => $book->id]);
                $edition->fill($this->editionAttributes($attributes, $actor, $existingVisibility));
                $edition->fill([
                    'disk' => $disk,
                    'path' => $path,
                    'original_name' => Str::limit($file->getClientOriginalName(), 255, ''),
                    'mime_type' => 'application/pdf',
                    'size_bytes' => $file->getSize(),
                    'sha256' => $sha256,
                    'rights_scan' => $rightsScan,
                    'rights_risk_level' => $riskLevel,
                    'uploaded_by' => $actor->id,
                    'uploaded_at' => now(),
                ]);
                $edition->save();

                activity('library')
                    ->causedBy($actor)
                    ->performedOn($book)
                    ->withProperties([
                        'digital_edition_id' => $edition->id,
                        'status' => $edition->status->value,
                        'visibility' => $edition->resolvedVisibility()->value,
                        'downloads_allowed' => $edition->downloads_allowed,
                        'rights_risk_level' => $riskLevel,
                        'piracy_blocked' => (bool) ($rightsScan['piracy_blocked'] ?? false),
                        'replacement' => $previousObject !== null,
                    ])
                    ->log($previousObject === null ? 'Uploaded a digital edition' : 'Replaced a digital edition');

                return [$edition, $previousObject];
            });
        } catch (Throwable $throwable) {
            Storage::disk($disk)->delete($path);

            throw $throwable;
        }

        if (is_array($previousObject)) {
            try {
                Storage::disk($previousObject['disk'])->delete($previousObject['path']);
            } catch (Throwable $throwable) {
                report($throwable);
            }
        }

        return $edition->refresh();
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    public function editionAttributes(
        array $attributes,
        User $actor,
        ?DigitalEditionVisibility $defaultVisibility = null
    ): array {
        $status = DigitalEditionStatus::from((string) $attributes['status']);
        $publishing = $status === DigitalEditionStatus::Published;
        $fallbackVisibility = $defaultVisibility ?? DigitalEditionVisibility::Public;
        $visibility = isset($attributes['visibility']) && $attributes['visibility'] !== ''
            ? (DigitalEditionVisibility::tryFrom((string) $attributes['visibility']) ?? $fallbackVisibility)
            : $fallbackVisibility;

        return [
            'status' => $status,
            'visibility' => $visibility,
            'downloads_allowed' => (bool) $attributes['downloads_allowed'],
            'rights_basis' => $attributes['rights_basis'] ?? null,
            'rights_holder' => $attributes['rights_holder'] ?? null,
            'license_url' => $attributes['license_url'] ?? null,
            'rights_notes' => $attributes['rights_notes'] ?? null,
            'rights_expires_at' => $attributes['rights_expires_at'] ?? null,
            'published_by' => $publishing ? $actor->id : null,
            'published_at' => $publishing ? now() : null,
            'rights_confirmed_by' => $publishing ? $actor->id : null,
            'rights_confirmed_at' => $publishing ? now() : null,
        ];
    }
}
