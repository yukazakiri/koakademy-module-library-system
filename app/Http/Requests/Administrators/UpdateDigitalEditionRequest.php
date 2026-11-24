<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Requests\Administrators;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Modules\LibrarySystem\Enums\DigitalEditionStatus;
use Modules\LibrarySystem\Enums\DigitalRightsBasis;
use Modules\LibrarySystem\Models\Book;
use Modules\LibrarySystem\Models\DigitalEdition;

final class UpdateDigitalEditionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $book = $this->route('book');

        return $book instanceof Book
            && ($this->user()?->can('manageDigitalEdition', $book) ?? false);
    }

    public function rules(): array
    {
        $publishing = $this->string('status')->toString() === DigitalEditionStatus::Published->value;

        return [
            'status' => ['required', Rule::enum(DigitalEditionStatus::class)],
            'downloads_allowed' => ['required', 'boolean'],
            'rights_basis' => [
                Rule::requiredIf($publishing),
                'nullable',
                Rule::enum(DigitalRightsBasis::class),
            ],
            'rights_holder' => ['nullable', 'string', 'max:255'],
            'license_url' => ['nullable', 'url:http,https', 'max:2048'],
            'rights_notes' => ['nullable', 'string', 'max:5000'],
            'rights_expires_at' => ['nullable', 'date', 'after:today'],
            'rights_confirmed' => $publishing
                ? ['required', 'accepted']
                : ['nullable', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $publishing = $this->string('status')->toString() === DigitalEditionStatus::Published->value;
                if (! $publishing) {
                    return;
                }

                $book = $this->route('book');
                if (! $book instanceof Book) {
                    return;
                }

                $edition = DigitalEdition::query()->where('book_id', $book->id)->first();
                if (! $edition instanceof DigitalEdition) {
                    return;
                }

                if ($edition->isPiracyBlocked()) {
                    $sources = implode(', ', (array) ($edition->rights_scan['piracy_sources'] ?? []));
                    $sourceNote = $sources !== '' ? " ({$sources})" : '';
                    $validator->errors()->add(
                        'status',
                        "Publishing is blocked because this PDF matched a known piracy-site watermark{$sourceNote}. Replace it with a rights-cleared PDF or remove the digital edition."
                    );

                    return;
                }

                $rightsNotes = mb_trim((string) $this->input('rights_notes', ''));
                $licenseUrl = mb_trim((string) $this->input('license_url', ''));

                if ($edition->hasHighCopyrightRisk() && $rightsNotes === '' && $licenseUrl === '') {
                    $validator->errors()->add(
                        'rights_notes',
                        'Copyright notices or commercial publisher markers were detected in this PDF. Record your written permission, license URL, or institutional rights notes before publishing.'
                    );
                }

                $rightsBasis = $this->string('rights_basis')->toString();
                if ($rightsBasis === DigitalRightsBasis::PublicDomain->value
                    && $book->publication_year !== null
                    && $book->publication_year >= 1930
                    && $rightsNotes === ''
                    && $licenseUrl === '') {
                    $validator->errors()->add(
                        'rights_notes',
                        "Books published in {$book->publication_year} are typically still protected by copyright. Document the public-domain basis or license URL before publishing."
                    );
                }
            },
        ];
    }
}
