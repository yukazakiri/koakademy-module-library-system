<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Http\Requests\Administrators;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use Modules\LibrarySystem\Models\Book;

final class InspectDigitalEditionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manageDigitalEdition', new Book) ?? false;
    }

    public function rules(): array
    {
        return [
            'pdf' => [
                'required',
                'file',
                'extensions:pdf',
                'mimes:pdf',
                'mimetypes:application/pdf,application/x-pdf',
                'max:'.config('librarysystem.ebooks.max_upload_kilobytes', 92160),
            ],
            'use_ai' => ['nullable', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $file = $this->file('pdf');

                if ($file === null || ! $file->isValid()) {
                    return;
                }

                $signature = file_get_contents($file->getRealPath(), false, null, 0, 5);

                if ($signature !== '%PDF-') {
                    $validator->errors()->add('pdf', 'The uploaded file does not contain a valid PDF signature.');
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'pdf.required' => 'Choose a PDF file to inspect.',
            'pdf.extensions' => 'The file must use the .pdf extension.',
            'pdf.mimes' => 'The uploaded file must be a valid PDF.',
            'pdf.mimetypes' => 'The uploaded file must report a PDF media type.',
            'pdf.max' => 'The PDF must be 90 MB or smaller.',
        ];
    }
}
