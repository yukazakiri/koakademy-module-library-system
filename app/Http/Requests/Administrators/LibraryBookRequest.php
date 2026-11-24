<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Requests\Administrators;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Modules\LibrarySystem\Enums\BookFormat;
use Modules\LibrarySystem\Enums\DigitalRightsBasis;

final class LibraryBookRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $format = BookFormat::tryFrom((string) $this->input('format', BookFormat::Physical->value))
            ?? BookFormat::Physical;
        $hasPhysicalInventory = $format->hasPhysicalInventory();

        return [
            'format' => ['nullable', Rule::enum(BookFormat::class)],
            'title' => ['required', 'string', 'max:255'],
            'isbn' => ['nullable', 'string', 'max:50'],
            'call_number' => ['nullable', 'string', 'max:255'],
            'accession_number' => ['nullable', 'string', 'max:255'],
            'author_id' => ['required', 'exists:library_authors,id'],
            'category_id' => ['required', 'exists:library_categories,id'],
            'publisher' => ['nullable', 'string', 'max:255'],
            'publication_year' => ['nullable', 'integer', 'min:1500', 'max:2100'],
            'pages' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'description' => ['nullable', 'string'],
            'cover_image' => ['nullable', 'string', 'max:255'],
            'cover_image_upload' => ['nullable', 'image', 'max:4096'],
            'total_copies' => $hasPhysicalInventory
                ? ['required', 'integer', 'min:1', 'max:10000']
                : ['nullable', 'integer', 'min:0', 'max:10000'],
            'available_copies' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'location' => ['nullable', 'string', 'max:255'],
            'status' => $hasPhysicalInventory
                ? ['required', 'in:available,borrowed,maintenance']
                : ['nullable', 'in:available,borrowed,maintenance'],
            'digital_pdf' => [
                'nullable',
                'file',
                'extensions:pdf',
                'mimes:pdf',
                'mimetypes:application/pdf,application/x-pdf',
                'max:'.config('librarysystem.ebooks.max_upload_kilobytes', 92160),
            ],
            'digital_rights_basis' => ['nullable', Rule::enum(DigitalRightsBasis::class)],
            'digital_rights_holder' => ['nullable', 'string', 'max:255'],
            'digital_license_url' => ['nullable', 'url:http,https', 'max:2048'],
            'digital_rights_notes' => ['nullable', 'string', 'max:5000'],
            'digital_rights_expires_at' => ['nullable', 'date', 'after:today'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $file = $this->file('digital_pdf');

                if ($file === null || ! $file->isValid()) {
                    return;
                }

                $signature = file_get_contents($file->getRealPath(), false, null, 0, 5);

                if ($signature !== '%PDF-') {
                    $validator->errors()->add('digital_pdf', 'The uploaded file does not contain a valid PDF signature.');
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'title.required' => 'Book title is required.',
            'author_id.required' => 'Select an author for this book.',
            'author_id.exists' => 'Selected author could not be found.',
            'category_id.required' => 'Select a category for this book.',
            'category_id.exists' => 'Selected category could not be found.',
            'total_copies.required' => 'Total copies is required for physical books.',
            'total_copies.min' => 'Total copies must be at least 1 for physical books.',
            'available_copies.min' => 'Available copies cannot be negative.',
            'status.in' => 'Choose a valid availability status.',
            'cover_image_upload.image' => 'Cover image must be a valid image file.',
            'cover_image_upload.max' => 'Cover image must be 4MB or smaller.',
            'digital_pdf.extensions' => 'The eBook file must use the .pdf extension.',
            'digital_pdf.mimes' => 'The eBook file must be a valid PDF.',
            'digital_pdf.mimetypes' => 'The eBook file must report a PDF media type.',
            'digital_pdf.max' => 'The eBook PDF must be 90 MB or smaller.',
        ];
    }
}
