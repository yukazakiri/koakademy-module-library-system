<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Services;

use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\DigitalEdition;
use Symfony\Component\HttpFoundation\Response as HttpResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Throwable;

final class DigitalEditionDeliveryService
{
    public function accessibleEdition(Book $book): DigitalEdition
    {
        $edition = $book->digitalEdition()->accessible()->first();
        abort_unless($edition instanceof DigitalEdition, 404);

        return $edition;
    }

    public function assertObjectExists(DigitalEdition $edition): void
    {
        try {
            $exists = Storage::disk($edition->disk)->exists($edition->path);
        } catch (Throwable $throwable) {
            report($throwable);
            abort(503, 'The digital edition is temporarily unavailable.');
        }

        abort_unless($exists, 404);
    }

    public function inlineResponse(Book $book, DigitalEdition $edition): HttpResponse
    {
        return $this->fileResponse($book, $edition, download: false);
    }

    public function downloadResponse(Book $book, DigitalEdition $edition, User $user): HttpResponse
    {
        abort_unless($edition->downloads_allowed, 403, 'Downloads are not permitted for this title.');
        $this->assertObjectExists($edition);

        activity('library')
            ->causedBy($user)
            ->performedOn($book)
            ->withProperties(['digital_edition_id' => $edition->id])
            ->log('Downloaded a digital edition');

        return $this->fileResponse($book, $edition, download: true);
    }

    private function fileResponse(Book $book, DigitalEdition $edition, bool $download): HttpResponse
    {
        $filename = (Str::slug($book->title) ?: 'book').'.pdf';
        $driver = config("filesystems.disks.{$edition->disk}.driver");

        try {
            if ($driver === 's3') {
                return $this->signedObjectResponse($edition, $filename, $download);
            }

            return $this->localDiskResponse($edition, $filename, $download);
        } catch (Throwable $throwable) {
            report($throwable);
            abort(503, 'The digital edition is temporarily unavailable.');
        }
    }

    private function signedObjectResponse(DigitalEdition $edition, string $filename, bool $download): HttpResponse
    {
        $minutes = (int) config(
            $download ? 'librarysystem.ebooks.download_url_minutes' : 'librarysystem.ebooks.reader_url_minutes',
            $download ? 5 : 60
        );
        $expiresAt = now()->addMinutes($minutes);

        if ($edition->rights_expires_at?->isBefore($expiresAt)) {
            $expiresAt = $edition->rights_expires_at;
        }

        $disposition = $download ? ResponseHeaderBag::DISPOSITION_ATTACHMENT : ResponseHeaderBag::DISPOSITION_INLINE;
        $url = Storage::disk($edition->disk)->temporaryUrl(
            $edition->path,
            $expiresAt,
            [
                'ResponseContentType' => 'application/pdf',
                'ResponseContentDisposition' => sprintf('%s; filename="%s"', $disposition, $filename),
                'ResponseCacheControl' => 'private, no-store',
            ]
        );

        return redirect()->away($url);
    }

    private function localDiskResponse(DigitalEdition $edition, string $filename, bool $download): HttpResponse
    {
        $headers = [
            'Content-Type' => 'application/pdf',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Robots-Tag' => 'noindex, nofollow',
        ];

        $disk = Storage::disk($edition->disk);
        $fullPath = $disk->path($edition->path);

        if (is_file($fullPath) && is_readable($fullPath)) {
            $response = response()->file($fullPath, $headers);
            $response->setContentDisposition(
                $download ? ResponseHeaderBag::DISPOSITION_ATTACHMENT : ResponseHeaderBag::DISPOSITION_INLINE,
                $filename
            );

            return $response;
        }

        if ($download) {
            return $disk->download($edition->path, $filename, $headers);
        }

        return $disk->response($edition->path, $filename, $headers, ResponseHeaderBag::DISPOSITION_INLINE);
    }
}
